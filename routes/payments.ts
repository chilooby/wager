import { Router, Context } from "oak";
import Stripe from "stripe";

const router = new Router();

// Create payment intent for wager stake
router.post("/payments/stake", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const body = await ctx.request.body({ type: "json" }).value;
    const { wagerId, paymentMethodId } = body;

    if (!wagerId || !paymentMethodId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "wagerId and paymentMethodId are required" };
      return;
    }

    const supabase = ctx.state.supabase;
    const stripe = ctx.state.stripe;

    // Get wager
    const { data: wager, error: wagerError } = await supabase
      .from("wagers")
      .select("*")
      .eq("id", wagerId)
      .single();

    if (wagerError || !wager) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }

    // Verify user is participant
    if (wager.participant_a_id !== user.id && wager.participant_b_id !== user.id) {
      ctx.response.status = 403;
      ctx.response.body = { error: "Not a participant in this wager" };
      return;
    }

    // Get user's Stripe customer ID
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData.stripe_customer_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "User not set up for payments" };
      return;
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(wager.amount * 100), // Convert to cents
      currency: "usd",
      customer: userData.stripe_customer_id,
      payment_method: paymentMethodId,
      confirm: true,
      metadata: {
        wagerId: wagerId,
        userId: user.id,
        type: "wager_stake",
      },
    });

    // Record transaction
    const { error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        wager_id: wagerId,
        type: "wager_stake",
        amount: wager.amount,
        stripe_payment_intent_id: paymentIntent.id,
        status: paymentIntent.status === "succeeded" ? "completed" : "processing",
      });

    if (txError) {
      console.error("Failed to record transaction:", txError);
    }

    ctx.response.body = {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Process wager payout
router.post("/payments/payout", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const body = await ctx.request.body({ type: "json" }).value;
    const { wagerId } = body;

    if (!wagerId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "wagerId is required" };
      return;
    }

    const supabase = ctx.state.supabase;
    const stripe = ctx.state.stripe;

    // Get wager
    const { data: wager, error: wagerError } = await supabase
      .from("wagers")
      .select("*")
      .eq("id", wagerId)
      .single();

    if (wagerError || !wager) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }

    // Verify wager is completed and user is winner
    if (wager.status !== "completed" || wager.winner_id !== user.id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Cannot process payout for this wager" };
      return;
    }

    // Calculate payout (stake * 2 - 10% fee)
    const gross = wager.amount * 2;
    const fee = gross * 0.1;
    const netPayout = gross - fee;

    // Get winner's Stripe account
    const { data: winnerData, error: winnerError } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", wager.winner_id)
      .single();

    if (winnerError || !winnerData.stripe_customer_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Winner not set up for payments" };
      return;
    }

    // Create transfer (in production, this would use Stripe Connect)
    const transfer = await stripe.transfers.create({
      amount: Math.round(netPayout * 100), // Convert to cents
      currency: "usd",
      destination: winnerData.stripe_customer_id,
      metadata: {
        wagerId: wagerId,
        winnerId: wager.winner_id,
        type: "wager_payout",
      },
    });

    // Record payout transaction
    const { error: payoutError } = await supabase
      .from("transactions")
      .insert({
        user_id: wager.winner_id,
        wager_id: wagerId,
        type: "wager_payout",
        amount: netPayout,
        stripe_transfer_id: transfer.id,
        status: "completed",
      });

    // Record fee transaction
    const { error: feeError } = await supabase
      .from("transactions")
      .insert({
        user_id: wager.winner_id,
        wager_id: wagerId,
        type: "fee",
        amount: -fee,
        status: "completed",
        metadata: { description: "Platform fee (10%)" },
      });

    ctx.response.body = {
      transferId: transfer.id,
      payoutAmount: netPayout,
      feeAmount: fee,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Stripe webhook handler
router.post("/payments/webhook", async (ctx: Context) => {
  try {
    const sig = ctx.request.headers.get("stripe-signature");
    const body = await ctx.request.body({ type: "text" }).value;
    
    const stripe = ctx.state.stripe;
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
    
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, sig!, webhookSecret);
    } catch (err) {
      ctx.response.status = 400;
      ctx.response.body = { error: `Webhook Error: ${err.message}` };
      return;
    }

    const supabase = ctx.state.supabase;

    // Handle different event types
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        
        // Update transaction status
        await supabase
          .from("transactions")
          .update({ status: "completed" })
          .eq("stripe_payment_intent_id", paymentIntent.id);
        
        break;
      }
      
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        
        // Update transaction status
        await supabase
          .from("transactions")
          .update({ status: "failed" })
          .eq("stripe_payment_intent_id", paymentIntent.id);
        
        break;
      }
      
      case "transfer.paid": {
        const transfer = event.data.object;
        
        // Update transaction status
        await supabase
          .from("transactions")
          .update({ status: "completed" })
          .eq("stripe_transfer_id", transfer.id);
        
        break;
      }
    }

    ctx.response.body = { received: true };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Get user transactions
router.get("/payments/transactions", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const supabase = ctx.state.supabase;
    const { data, error } = await supabase
      .from("transactions")
      .select(`
        *,
        wager:wager_id(*)
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { transactions: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

export default router;