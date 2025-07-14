// main.ts
import { Application, Router, Context } from "oak";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import Stripe from "stripe";

// --- ENV ---
const PORT = Number(Deno.env.get("PORT") || 8000);
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_xxx";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "whsec_xxx";
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16", httpClient: Stripe.createFetchHttpClient() });

// --- In-memory store ---
interface Wager {
  id: string;
  userA: string;
  userB: string;
  stakeUsd: number;
  paymentIntents: Record<string, string>; // customerId -> paymentIntentId
  settled?: { winnerCustomerId: string; transferId: string };
}
const wagers = new Map<string, Wager>();

// --- Router ---
const router = new Router();

// POST /wager – create {userA,userB,stakeUsd} → returns wagerId.
router.post("/wager", async (ctx) => {
  const { userA, userB, stakeUsd } = await ctx.request.body({ type: "json" }).value;
  if (!userA || !userB || typeof stakeUsd !== "number") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userA, userB, or stakeUsd" };
    return;
  }
  const id = crypto.randomUUID();
  wagers.set(id, { id, userA, userB, stakeUsd, paymentIntents: {} });
  ctx.response.body = { wagerId: id };
});

// POST /wager/:id/stake – attach PaymentIntent for a player (customerId, paymentMethodId).
router.post("/wager/:id/stake", async (ctx) => {
  const { id } = ctx.params;
  const wager = wagers.get(id!);
  if (!wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  const { customerId, paymentMethodId } = await ctx.request.body({ type: "json" }).value;
  if (!customerId || !paymentMethodId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing customerId or paymentMethodId" };
    return;
  }
  // Create PaymentIntent for the stake
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(wager.stakeUsd * 100),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    confirm: true,
    metadata: { wagerId: id, player: customerId },
  });
  wager.paymentIntents[customerId] = paymentIntent.id;
  ctx.response.body = { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
});

// POST /wager/:id/settle – admin call {winnerCustomerId} → creates Stripe transfer of (stake*2‑10%) to winner.
router.post("/wager/:id/settle", async (ctx) => {
  const { id } = ctx.params;
  const wager = wagers.get(id!);
  if (!wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  if (wager.settled) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Wager already settled" };
    return;
  }
  const { winnerCustomerId } = await ctx.request.body({ type: "json" }).value;
  if (!winnerCustomerId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing winnerCustomerId" };
    return;
  }
  // Calculate payout: (stake * 2) - 10%
  const gross = wager.stakeUsd * 2;
  const payout = Math.round(gross * 0.9 * 100); // in cents
  // Create a Stripe transfer (simulate: in real app, use Stripe Connect)
  // Here, we just create a payout to the winner's customer account (requires a connected account in real Stripe)
  // For demo, we just log and store
  const transfer = await stripe.transfers.create({
    amount: payout,
    currency: "usd",
    destination: winnerCustomerId, // In real app, this is a connected account ID
    metadata: { wagerId: id },
  });
  wager.settled = { winnerCustomerId, transferId: transfer.id };
  ctx.response.body = { transferId: transfer.id, payoutUsd: payout / 100 };
});

// Webhook at /stripe/webhook handling payment_intent.succeeded & payout.paid.
router.post("/stripe/webhook", async (ctx) => {
  const sig = ctx.request.headers.get("stripe-signature");
  const body = await ctx.request.body({ type: "text" }).value;
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    ctx.response.status = 400;
    ctx.response.body = { error: `Webhook Error: ${err.message}` };
    return;
  }
  if (event.type === "payment_intent.succeeded") {
    // Optionally, mark payment as complete in wager
    // ...
  } else if (event.type === "payout.paid") {
    // Optionally, mark payout as complete
    // ...
  }
  ctx.response.body = { received: true };
});

// --- App ---
const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Wager backend listening on http://localhost:${PORT}`);
await app.listen({ port: PORT }); 