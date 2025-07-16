// main.ts
import { Application, Router, Context } from "oak";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import Stripe from "stripe";

// --- ENV ---
const PORT = Number(Deno.env.get("PORT") || 8000);
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_xxx";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "whsec_xxx";
const HOUSE_FEE_PERCENT = Number(Deno.env.get("HOUSE_FEE_PERCENT") || 10);
const stripe = new Stripe(STRIPE_SECRET_KEY, { 
  apiVersion: "2023-08-16", 
  httpClient: Stripe.createFetchHttpClient() 
});

// --- Types ---
interface User {
  id: string;
  email: string;
  stripeAccountId?: string;
  stripeCustomerId?: string;
  walletBalance: number; // in cents
  escrowBalance: number; // in cents (funds locked in wagers)
}

interface Wager {
  id: string;
  userAId: string;
  userBId: string;
  stakeAmountCents: number;
  escrowHoldIds: {
    userA?: string; // escrow hold transaction id
    userB?: string;
  };
  status: "pending" | "active" | "settled" | "cancelled";
  winnerId?: string;
  payoutTransferId?: string;
  createdAt: Date;
}

interface EscrowHold {
  id: string;
  userId: string;
  wagerId: string;
  amountCents: number;
  status: "held" | "released" | "captured";
  createdAt: Date;
}

// --- In-memory stores ---
const users = new Map<string, User>();
const wagers = new Map<string, Wager>();
const escrowHolds = new Map<string, EscrowHold>();

// --- Helper functions ---
async function ensureStripeAccount(userId: string): Promise<string> {
  const user = users.get(userId);
  if (!user) throw new Error("User not found");
  
  if (!user.stripeAccountId) {
    // Create Stripe Connect Custom account
    const account = await stripe.accounts.create({
      type: "custom",
      country: "US",
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      metadata: { userId },
    });
    
    user.stripeAccountId = account.id;
    users.set(userId, user);
  }
  
  return user.stripeAccountId;
}

async function lockFundsInEscrow(userId: string, amountCents: number, wagerId: string): Promise<string> {
  const user = users.get(userId);
  if (!user) throw new Error("User not found");
  
  if (user.walletBalance < amountCents) {
    throw new Error("Insufficient wallet balance");
  }
  
  // Create escrow hold
  const holdId = crypto.randomUUID();
  const hold: EscrowHold = {
    id: holdId,
    userId,
    wagerId,
    amountCents,
    status: "held",
    createdAt: new Date(),
  };
  
  // Update balances
  user.walletBalance -= amountCents;
  user.escrowBalance += amountCents;
  
  escrowHolds.set(holdId, hold);
  users.set(userId, user);
  
  return holdId;
}

async function releaseFundsFromEscrow(holdId: string): Promise<void> {
  const hold = escrowHolds.get(holdId);
  if (!hold || hold.status !== "held") throw new Error("Invalid escrow hold");
  
  const user = users.get(hold.userId);
  if (!user) throw new Error("User not found");
  
  // Release funds back to wallet
  user.escrowBalance -= hold.amountCents;
  user.walletBalance += hold.amountCents;
  
  hold.status = "released";
  escrowHolds.set(holdId, hold);
  users.set(hold.userId, user);
}

// --- Router ---
const router = new Router();

// POST /user - Create user account
router.post("/user", async (ctx) => {
  const { email } = await ctx.request.body({ type: "json" }).value;
  if (!email) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing email" };
    return;
  }
  
  const userId = crypto.randomUUID();
  const user: User = {
    id: userId,
    email,
    walletBalance: 0,
    escrowBalance: 0,
  };
  
  // Create Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  user.stripeCustomerId = customer.id;
  
  users.set(userId, user);
  ctx.response.body = { userId, stripeCustomerId: customer.id };
});

// GET /user/:id - Get user info
router.get("/user/:id", async (ctx) => {
  const { id } = ctx.params;
  const user = users.get(id!);
  if (!user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  ctx.response.body = {
    id: user.id,
    email: user.email,
    walletBalanceUsd: user.walletBalance / 100,
    escrowBalanceUsd: user.escrowBalance / 100,
    stripeAccountId: user.stripeAccountId,
    kycStatus: user.stripeAccountId ? "pending" : "not_started",
  };
});

// POST /user/:id/onboarding - Start KYC/AML onboarding
router.post("/user/:id/onboarding", async (ctx) => {
  const { id } = ctx.params;
  const { refreshUrl, returnUrl } = await ctx.request.body({ type: "json" }).value;
  
  const stripeAccountId = await ensureStripeAccount(id!);
  
  // Create account link for onboarding
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl || `http://localhost:${PORT}/user/${id}/onboarding/refresh`,
    return_url: returnUrl || `http://localhost:${PORT}/user/${id}/onboarding/return`,
    type: "account_onboarding",
  });
  
  ctx.response.body = { onboardingUrl: accountLink.url };
});

// POST /user/:id/wallet/topup - Top up wallet with Stripe Payment Intent
router.post("/user/:id/wallet/topup", async (ctx) => {
  const { id } = ctx.params;
  const { amountUsd, paymentMethodId } = await ctx.request.body({ type: "json" }).value;
  
  const user = users.get(id!);
  if (!user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  if (!amountUsd || amountUsd <= 0) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Invalid amount" };
    return;
  }
  
  const amountCents = Math.round(amountUsd * 100);
  
  // Create payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: user.stripeCustomerId,
    payment_method: paymentMethodId,
    confirm: true,
    metadata: { 
      userId: id,
      type: "wallet_topup",
    },
  });
  
  // If payment succeeded immediately, update wallet
  if (paymentIntent.status === "succeeded") {
    user.walletBalance += amountCents;
    users.set(id!, user);
  }
  
  ctx.response.body = { 
    paymentIntentId: paymentIntent.id, 
    status: paymentIntent.status,
    clientSecret: paymentIntent.client_secret,
  };
});

// POST /wager - Create wager
router.post("/wager", async (ctx) => {
  const { userAId, userBId, stakeUsd } = await ctx.request.body({ type: "json" }).value;
  
  if (!userAId || !userBId || !stakeUsd || stakeUsd <= 0) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Invalid wager parameters" };
    return;
  }
  
  const userA = users.get(userAId);
  const userB = users.get(userBId);
  
  if (!userA || !userB) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  const wagerId = crypto.randomUUID();
  const wager: Wager = {
    id: wagerId,
    userAId,
    userBId,
    stakeAmountCents: Math.round(stakeUsd * 100),
    escrowHoldIds: {},
    status: "pending",
    createdAt: new Date(),
  };
  
  wagers.set(wagerId, wager);
  ctx.response.body = { wagerId };
});

// POST /wager/:id/lock - Lock funds for a wager participant
router.post("/wager/:id/lock", async (ctx) => {
  const { id } = ctx.params;
  const { userId } = await ctx.request.body({ type: "json" }).value;
  
  const wager = wagers.get(id!);
  if (!wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  
  if (wager.status !== "pending") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Wager is not in pending state" };
    return;
  }
  
  // Verify user is participant
  const isUserA = userId === wager.userAId;
  const isUserB = userId === wager.userBId;
  if (!isUserA && !isUserB) {
    ctx.response.status = 403;
    ctx.response.body = { error: "User is not a participant" };
    return;
  }
  
  // Check if already locked
  if ((isUserA && wager.escrowHoldIds.userA) || (isUserB && wager.escrowHoldIds.userB)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Funds already locked for this user" };
    return;
  }
  
  try {
    // Lock funds in escrow
    const holdId = await lockFundsInEscrow(userId, wager.stakeAmountCents, id!);
    
    if (isUserA) {
      wager.escrowHoldIds.userA = holdId;
    } else {
      wager.escrowHoldIds.userB = holdId;
    }
    
    // If both users have locked funds, activate wager
    if (wager.escrowHoldIds.userA && wager.escrowHoldIds.userB) {
      wager.status = "active";
    }
    
    wagers.set(id!, wager);
    
    ctx.response.body = { 
      holdId, 
      wagerStatus: wager.status,
      escrowAmountUsd: wager.stakeAmountCents / 100,
    };
  } catch (error) {
    ctx.response.status = 400;
    ctx.response.body = { error: error.message };
  }
});

// POST /wager/:id/settle - Settle wager and payout winner
router.post("/wager/:id/settle", async (ctx) => {
  const { id } = ctx.params;
  const { winnerId } = await ctx.request.body({ type: "json" }).value;
  
  const wager = wagers.get(id!);
  if (!wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  
  if (wager.status !== "active") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Wager is not active" };
    return;
  }
  
  if (winnerId !== wager.userAId && winnerId !== wager.userBId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Winner must be a participant" };
    return;
  }
  
  const winner = users.get(winnerId);
  const loser = users.get(winnerId === wager.userAId ? wager.userBId : wager.userAId);
  
  if (!winner || !loser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Calculate payout (total stake minus house fee)
  const totalStake = wager.stakeAmountCents * 2;
  const houseFee = Math.round(totalStake * (HOUSE_FEE_PERCENT / 100));
  const payoutAmount = totalStake - houseFee;
  
  try {
    // Ensure winner has Stripe account for payout
    const winnerStripeAccountId = await ensureStripeAccount(winnerId);
    
    // Create transfer to winner's Stripe account
    const transfer = await stripe.transfers.create({
      amount: payoutAmount,
      currency: "usd",
      destination: winnerStripeAccountId,
      metadata: {
        wagerId: id,
        winnerId,
        houseFee,
      },
    });
    
    // Update escrow holds
    const winnerHoldId = winnerId === wager.userAId ? wager.escrowHoldIds.userA : wager.escrowHoldIds.userB;
    const loserHoldId = winnerId === wager.userAId ? wager.escrowHoldIds.userB : wager.escrowHoldIds.userA;
    
    if (winnerHoldId) {
      const hold = escrowHolds.get(winnerHoldId);
      if (hold) {
        hold.status = "captured";
        winner.escrowBalance -= hold.amountCents;
        escrowHolds.set(winnerHoldId, hold);
      }
    }
    
    if (loserHoldId) {
      const hold = escrowHolds.get(loserHoldId);
      if (hold) {
        hold.status = "captured";
        loser.escrowBalance -= hold.amountCents;
        escrowHolds.set(loserHoldId, hold);
      }
    }
    
    // Update wager
    wager.status = "settled";
    wager.winnerId = winnerId;
    wager.payoutTransferId = transfer.id;
    
    users.set(winnerId, winner);
    users.set(loser.id, loser);
    wagers.set(id!, wager);
    
    ctx.response.body = {
      transferId: transfer.id,
      payoutUsd: payoutAmount / 100,
      houseFeeUsd: houseFee / 100,
      winnerId,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// POST /wager/:id/cancel - Cancel pending wager and release locked funds
router.post("/wager/:id/cancel", async (ctx) => {
  const { id } = ctx.params;
  
  const wager = wagers.get(id!);
  if (!wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  
  if (wager.status !== "pending" && wager.status !== "active") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Cannot cancel settled wager" };
    return;
  }
  
  // Release any locked funds
  if (wager.escrowHoldIds.userA) {
    await releaseFundsFromEscrow(wager.escrowHoldIds.userA);
  }
  if (wager.escrowHoldIds.userB) {
    await releaseFundsFromEscrow(wager.escrowHoldIds.userB);
  }
  
  wager.status = "cancelled";
  wagers.set(id!, wager);
  
  ctx.response.body = { status: "cancelled", fundsReleased: true };
});

// Webhook handler
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
  
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const userId = paymentIntent.metadata.userId;
      const type = paymentIntent.metadata.type;
      
      if (type === "wallet_topup" && userId) {
        const user = users.get(userId);
        if (user) {
          user.walletBalance += paymentIntent.amount;
          users.set(userId, user);
        }
      }
      break;
    }
    
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      // Check if KYC is complete
      if (account.charges_enabled && account.payouts_enabled) {
        // Find user by stripeAccountId
        for (const [userId, user] of users) {
          if (user.stripeAccountId === account.id) {
            console.log(`User ${userId} completed KYC`);
            break;
          }
        }
      }
      break;
    }
    
    case "transfer.created": {
      const transfer = event.data.object as Stripe.Transfer;
      console.log(`Transfer created: ${transfer.id} for ${transfer.amount / 100} USD`);
      break;
    }
  }
  
  ctx.response.body = { received: true };
});

// --- App ---
const app = new Application();

// Error handling middleware
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
    ctx.response.status = err.status || 500;
    ctx.response.body = { error: err.message };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Wager backend with Stripe Connect listening on http://localhost:${PORT}`);
await app.listen({ port: PORT }); 