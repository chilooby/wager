// main.ts
import { Application, Router, Context } from "oak";
import { oakCors } from "cors";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import Stripe from "stripe";

// Import new modules
import { initDatabase, getDbClient } from "./db/database.ts";
import { initFirebase } from "./auth/firebase.ts";
import { authRouter } from "./routes/auth.ts";
import { socialRouter } from "./routes/social.ts";
import { authMiddleware } from "./middleware/auth.ts";

// --- ENV ---
const PORT = Number(Deno.env.get("PORT") || 8000);
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_xxx";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "whsec_xxx";
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16", httpClient: Stripe.createFetchHttpClient() });

// --- Initialize services ---
await initDatabase();
initFirebase();

// --- Router ---
const router = new Router();

// Health check endpoint
router.get("/health", (ctx) => {
  ctx.response.body = { status: "ok", timestamp: new Date().toISOString() };
});

// POST /wager – create wager (now requires authentication)
router.post("/wager", authMiddleware, async (ctx) => {
  const userId = ctx.state.user!.id;
  const { opponentId, stakeUsd } = await ctx.request.body({ type: "json" }).value;
  
  if (!opponentId || typeof stakeUsd !== "number") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing opponentId or stakeUsd" };
    return;
  }

  const client = await getDbClient();

  // Verify opponent exists
  const opponent = await client.queryObject`
    SELECT id FROM users WHERE id = ${opponentId}
  `;

  if (opponent.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Opponent not found" };
    return;
  }

  // Verify users are friends
  const friendship = await client.queryObject`
    SELECT id FROM friendships
    WHERE ((user_id = ${userId} AND friend_id = ${opponentId})
        OR (user_id = ${opponentId} AND friend_id = ${userId}))
      AND status = 'accepted'
  `;

  if (friendship.rows.length === 0) {
    ctx.response.status = 403;
    ctx.response.body = { error: "You can only create wagers with friends" };
    return;
  }

  // Create wager in database
  const result = await client.queryObject<{ id: string }>`
    INSERT INTO wagers (user_a_id, user_b_id, stake_usd, status)
    VALUES (${userId}, ${opponentId}, ${stakeUsd}, 'pending')
    RETURNING id
  `;

  ctx.response.body = { wagerId: result.rows[0].id };
});

// POST /wager/:id/stake – attach PaymentIntent for a player
router.post("/wager/:id/stake", authMiddleware, async (ctx) => {
  const { id } = ctx.params;
  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  // Get wager from database
  const wagerResult = await client.queryObject<{
    id: string;
    user_a_id: string;
    user_b_id: string;
    stake_usd: number;
    status: string;
  }>`
    SELECT id, user_a_id, user_b_id, stake_usd, status
    FROM wagers
    WHERE id = ${id}
  `;

  if (wagerResult.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }

  const wager = wagerResult.rows[0];

  // Verify user is part of the wager
  if (userId !== wager.user_a_id && userId !== wager.user_b_id) {
    ctx.response.status = 403;
    ctx.response.body = { error: "You are not part of this wager" };
    return;
  }

  // Check if user already staked
  const existingPayment = await client.queryObject`
    SELECT id FROM wager_payments
    WHERE wager_id = ${id} AND user_id = ${userId}
  `;

  if (existingPayment.rows.length > 0) {
    ctx.response.status = 409;
    ctx.response.body = { error: "You have already staked for this wager" };
    return;
  }

  const { paymentMethodId } = await ctx.request.body({ type: "json" }).value;
  if (!paymentMethodId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing paymentMethodId" };
    return;
  }

  // Get user's Stripe customer ID (you'll need to implement this)
  // For now, we'll use the user ID as a placeholder
  const customerId = `cus_${userId}`;

  // Create PaymentIntent for the stake
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(wager.stake_usd * 100),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    confirm: true,
    metadata: { wagerId: id, userId },
  });

  // Store payment intent in database
  await client.queryArray`
    INSERT INTO wager_payments (wager_id, user_id, stripe_payment_intent_id, amount_cents, status)
    VALUES (${id}, ${userId}, ${paymentIntent.id}, ${paymentIntent.amount}, ${paymentIntent.status})
  `;

  // Check if both players have staked
  const payments = await client.queryObject`
    SELECT COUNT(DISTINCT user_id) as count
    FROM wager_payments
    WHERE wager_id = ${id}
  `;

  if ((payments.rows[0] as any).count === 2) {
    // Both players have staked, activate the wager
    await client.queryArray`
      UPDATE wagers 
      SET status = 'active'
      WHERE id = ${id}
    `;
  }

  ctx.response.body = { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
});

// POST /wager/:id/settle – admin call to settle wager
router.post("/wager/:id/settle", authMiddleware, async (ctx) => {
  const { id } = ctx.params;
  const client = await getDbClient();

  // Get wager from database
  const wagerResult = await client.queryObject<{
    id: string;
    user_a_id: string;
    user_b_id: string;
    stake_usd: number;
    status: string;
    winner_id: string | null;
  }>`
    SELECT id, user_a_id, user_b_id, stake_usd, status, winner_id
    FROM wagers
    WHERE id = ${id}
  `;

  if (wagerResult.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }

  const wager = wagerResult.rows[0];

  if (wager.status === 'settled') {
    ctx.response.status = 400;
    ctx.response.body = { error: "Wager already settled" };
    return;
  }

  if (wager.status !== 'active') {
    ctx.response.status = 400;
    ctx.response.body = { error: "Wager is not active" };
    return;
  }

  const { winnerId } = await ctx.request.body({ type: "json" }).value;
  if (!winnerId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing winnerId" };
    return;
  }

  // Verify winner is part of the wager
  if (winnerId !== wager.user_a_id && winnerId !== wager.user_b_id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Winner must be one of the wager participants" };
    return;
  }

  // Calculate payout: (stake * 2) - 10%
  const gross = wager.stake_usd * 2;
  const payout = Math.round(gross * 0.9 * 100); // in cents

  // Create a Stripe transfer (requires Stripe Connect setup)
  // For now, we'll just log the transfer
  const transferId = `tr_${crypto.randomUUID()}`;

  // Update wager in database
  await client.queryArray`
    UPDATE wagers 
    SET status = 'settled', winner_id = ${winnerId}, settled_at = NOW()
    WHERE id = ${id}
  `;

  ctx.response.body = { transferId, payoutUsd: payout / 100 };
});

// GET /wager/:id – get wager details
router.get("/wager/:id", authMiddleware, async (ctx) => {
  const { id } = ctx.params;
  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  const wagerResult = await client.queryObject`
    SELECT 
      w.id,
      w.stake_usd,
      w.status,
      w.created_at,
      w.accepted_at,
      w.settled_at,
      ua.id as user_a_id,
      ua.username as user_a_username,
      ua.display_name as user_a_display_name,
      ua.avatar_url as user_a_avatar_url,
      ub.id as user_b_id,
      ub.username as user_b_username,
      ub.display_name as user_b_display_name,
      ub.avatar_url as user_b_avatar_url,
      winner.id as winner_id,
      winner.username as winner_username
    FROM wagers w
    JOIN users ua ON w.user_a_id = ua.id
    JOIN users ub ON w.user_b_id = ub.id
    LEFT JOIN users winner ON w.winner_id = winner.id
    WHERE w.id = ${id}
      AND (w.user_a_id = ${userId} OR w.user_b_id = ${userId})
  `;

  if (wagerResult.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }

  // Get payment status
  const payments = await client.queryObject`
    SELECT 
      user_id,
      stripe_payment_intent_id,
      status,
      created_at
    FROM wager_payments
    WHERE wager_id = ${id}
  `;

  ctx.response.body = {
    wager: wagerResult.rows[0],
    payments: payments.rows,
  };
});

// Webhook at /stripe/webhook handling payment_intent.succeeded & payout.paid
router.post("/stripe/webhook", async (ctx) => {
  const sig = ctx.request.headers.get("stripe-signature");
  const body = await ctx.request.body({ type: "text" }).value;
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    ctx.response.status = 400;
    ctx.response.body = { error: `Webhook Error: ${err.message}` };
    return;
  }
  
  const client = await getDbClient();

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    
    // Update payment status in database
    await client.queryArray`
      UPDATE wager_payments
      SET status = ${paymentIntent.status}
      WHERE stripe_payment_intent_id = ${paymentIntent.id}
    `;
  } else if (event.type === "payout.paid") {
    // Handle payout confirmation
  }

  ctx.response.body = { received: true };
});

// --- App ---
const app = new Application();

// Add CORS middleware
app.use(oakCors({
  origin: Deno.env.get("FRONTEND_URL") || "http://localhost:3000",
  credentials: true,
}));

// Add routers
app.use(router.routes());
app.use(router.allowedMethods());
app.use(authRouter.routes());
app.use(authRouter.allowedMethods());
app.use(socialRouter.routes());
app.use(socialRouter.allowedMethods());

// Error handling middleware
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Server error:", err);
    ctx.response.status = err.status || 500;
    ctx.response.body = { error: err.message || "Internal server error" };
  }
});

console.log(`Wager backend listening on http://localhost:${PORT}`);
await app.listen({ port: PORT }); 