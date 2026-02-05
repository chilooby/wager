// main.ts
import { Application, Router, Context } from "oak";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import Stripe from "stripe";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
// Simple authentication system (Firebase integration will be added later)
// For now, we'll use a simple token-based system for development

// --- ENV ---
const PORT = Number(Deno.env.get("PORT") || 8000);
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_xxx";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "whsec_xxx";
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16", httpClient: Stripe.createFetchHttpClient() });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_STORAGE_BUCKET = Deno.env.get("SUPABASE_STORAGE_BUCKET") || "wager-results";

// Firebase configuration (for future use)
const FIREBASE_API_KEY = Deno.env.get("FIREBASE_API_KEY")!;
const FIREBASE_AUTH_DOMAIN = Deno.env.get("FIREBASE_AUTH_DOMAIN")!;
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Simple in-memory user store for development
const users = new Map<string, { id: string; email: string; displayName: string; password: string }>();
const tokens = new Map<string, string>(); // token -> userId



// --- In-memory store ---
interface Wager {
  id: string;
  userA: string;
  userB: string;
  stakeUsd: number;
  paymentIntents: Record<string, string>; // customerId -> paymentIntentId
  settled?: { winnerCustomerId: string; transferId: string };
  verification_status?: 'pending' | 'verified' | 'disputed';
}
const wagers = new Map<string, Wager>();

// In-memory wager results: { [wagerId]: { [userId]: { imageUrl, uploadedAt } } }
const wagerResults = new Map<string, Record<string, { imageUrl: string; uploadedAt: string }>>();

// --- Middleware ---
// Simple token verification middleware (for development)
async function verifyFirebaseToken(ctx: Context, next: () => Promise<unknown>) {
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Missing or invalid authorization header" };
    return;
  }
  
  const token = authHeader.substring(7);
  const userId = tokens.get(token);
  
  if (userId) {
    ctx.state.user = { uid: userId };
    await next();
  } else {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid token" };
  }
}

// --- Router ---
const router = new Router();

// Authentication endpoints (no auth required)
router.post("/auth/register", async (ctx) => {
  const { email, password, displayName } = await ctx.request.body({ type: "json" }).value;
  
  if (!email || !password) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Email and password are required" };
    return;
  }
  
  try {
    // Check if user already exists
    if (users.has(email)) {
      ctx.response.status = 409;
      ctx.response.body = { error: "User already exists" };
      return;
    }
    
    // Create user in memory (for development)
    const userId = crypto.randomUUID();
    users.set(email, {
      id: userId,
      email,
      displayName: displayName || email,
      password // In production, this should be hashed
    });
    
    // Create user in our database
    const { data: user, error } = await supabase.from("users").insert({
      email: email,
      display_name: displayName || null,
      firebase_uid: userId, // Using our generated ID for now
      auth_provider: "email"
    }).select("id, email, display_name, firebase_uid").single();
    
    if (error) {
      console.error("Database error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to create user" };
      return;
    }
    
    ctx.response.body = { 
      user: { id: user.id, email: user.email, display_name: user.display_name },
      firebase_uid: userId
    };
  } catch (error) {
    console.error("Registration error:", error);
    ctx.response.status = 400;
    ctx.response.body = { error: error.message };
  }
});

router.post("/auth/login", async (ctx) => {
  const { email, password } = await ctx.request.body({ type: "json" }).value;
  
  if (!email || !password) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Email and password are required" };
    return;
  }
  
  try {
    // Check if user exists in memory
    const user = users.get(email);
    if (!user || user.password !== password) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid credentials" };
      return;
    }
    
    // Get user from our database
    const { data: dbUser, error } = await supabase
      .from("users")
      .select("id, email, display_name, firebase_uid, profile_image_url, is_online")
      .eq("firebase_uid", user.id)
      .single();
    
    if (error || !dbUser) {
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found in database" };
      return;
    }
    
    // Generate a simple token
    const token = crypto.randomUUID();
    tokens.set(token, user.id);
    
    // Update online status
    await supabase
      .from("users")
      .update({ is_online: true, last_seen: new Date().toISOString() })
      .eq("id", dbUser.id);
    
    ctx.response.body = { 
      user: { 
        id: dbUser.id, 
        email: dbUser.email, 
        display_name: dbUser.display_name,
        profile_image_url: dbUser.profile_image_url,
        is_online: true
      },
      firebase_uid: user.id,
      token: token
    };
  } catch (error) {
    console.error("Login error:", error);
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid credentials" };
  }
});

// Protected endpoints (require Firebase token)
router.get("/auth/me", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, display_name, profile_image_url, is_online, last_seen, kyc_status")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (error || !user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  ctx.response.body = { user };
});

// Friend management endpoints
router.get("/friends", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  
  // Get user ID from Firebase UID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Get friends list
  const { data: friends, error } = await supabase
    .from("friends")
    .select(`
      friend_id,
      users!friends_friend_id_fkey (
        id, display_name, email, profile_image_url, is_online, last_seen
      )
    `)
    .eq("user_id", currentUser.id);
  
  if (error) {
    console.error("Friends fetch error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to fetch friends" };
    return;
  }
  
  ctx.response.body = { friends: friends.map(f => f.users) };
});

router.post("/friends/request", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  const { toUserId, message } = await ctx.request.body({ type: "json" }).value;
  
  if (!toUserId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "toUserId is required" };
    return;
  }
  
  // Get current user ID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Check if request already exists
  const { data: existingRequest } = await supabase
    .from("friend_requests")
    .select("id")
    .eq("from_user_id", currentUser.id)
    .eq("to_user_id", toUserId)
    .single();
  
  if (existingRequest) {
    ctx.response.status = 409;
    ctx.response.body = { error: "Friend request already sent" };
    return;
  }
  
  // Create friend request
  const { data: request, error } = await supabase
    .from("friend_requests")
    .insert({
      from_user_id: currentUser.id,
      to_user_id: toUserId,
      message: message || null
    })
    .select()
    .single();
  
  if (error) {
    console.error("Friend request error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to send friend request" };
    return;
  }
  
  ctx.response.body = { request };
});

router.post("/friends/request/:requestId/respond", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  const { requestId } = ctx.params;
  const { action } = await ctx.request.body({ type: "json" }).value; // 'accept' or 'decline'
  
  if (!["accept", "decline"].includes(action)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Action must be 'accept' or 'decline'" };
    return;
  }
  
  // Get current user ID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Update friend request status
  const { data: request, error } = await supabase
    .from("friend_requests")
    .update({ 
      status: action === "accept" ? "accepted" : "declined",
      updated_at: new Date().toISOString()
    })
    .eq("id", requestId)
    .eq("to_user_id", currentUser.id)
    .select()
    .single();
  
  if (error || !request) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Friend request not found" };
    return;
  }
  
  // If accepted, create friendship
  if (action === "accept") {
    await supabase.from("friends").insert([
      { user_id: request.from_user_id, friend_id: request.to_user_id },
      { user_id: request.to_user_id, friend_id: request.from_user_id }
    ]);
  }
  
  ctx.response.body = { request };
});

// POST /wager – create {userA,userB,stakeUsd} → returns wagerId.
router.post("/wager", async (ctx) => {
  const { userA, userB, stakeUsd } = await ctx.request.body({ type: "json" }).value;
  if (!userA || !userB || typeof stakeUsd !== "number") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userA, userB, or stakeUsd" };
    return;
  }
  const { data, error } = await supabase.from("wagers").insert({
    user_a: userA,
    user_b: userB,
    stake_usd: stakeUsd,
    verification_status: "pending"
  }).select("id").single();
  if (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
    return;
  }
  ctx.response.body = { wagerId: data.id };
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

// POST /wager/:id/upload-result – user uploads result image (accepts multipart/form-data)
router.post("/wager/:id/upload-result", async (ctx) => {
  const { id } = ctx.params;
  const body = ctx.request.body({ type: "form-data" });
  const formData = await body.value.read({ maxFileSize: 10_000_000 }); // 10MB max

  const userId = formData.fields.userId;
  const image = formData.files?.find(f => f.name === "image");

  if (!userId || !image) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userId or image file" };
    return;
  }

  // Check wager exists (same as before)
  const { data: wager, error: wagerError } = await supabase.from("wagers").select("*").eq("id", id).single();
  if (wagerError || !wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  if (![wager.user_a, wager.user_b].includes(userId)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "User not part of this wager" };
    return;
  }

  // Read file content
  const fileContent = await Deno.readFile(image.filename!);
  const ext = image.filename?.split('.').pop() || 'jpg';
  const storagePath = `${id}/${userId}_${Date.now()}.${ext}`;
  const { data: uploadData, error: uploadError } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(storagePath, fileContent, { upsert: true, contentType: image.contentType });
  if (uploadError) {
    ctx.response.status = 500;
    ctx.response.body = { error: uploadError.message };
    return;
  }
  // Get public URL
  const { data: publicUrlData } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(storagePath);
  const imageUrl = publicUrlData?.publicUrl;
  if (!imageUrl) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to get public URL for image" };
    return;
  }
  // Upsert wager_result for this user/wager
  const { error: upsertError } = await supabase.from("wager_results").upsert({
    wager_id: id,
    user_id: userId,
    image_url: imageUrl,
    status: "pending"
  }, { onConflict: "wager_id,user_id" });
  if (upsertError) {
    ctx.response.status = 500;
    ctx.response.body = { error: upsertError.message };
    return;
  }
  // Check if both users have uploaded
  const { data: results, error: resultsError } = await supabase.from("wager_results").select("user_id").eq("wager_id", id);
  if (resultsError) {
    ctx.response.status = 500;
    ctx.response.body = { error: resultsError.message };
    return;
  }
  let verification_status = "pending";
  if (results && results.some(r => r.user_id === wager.user_a) && results.some(r => r.user_id === wager.user_b)) {
    verification_status = "verified";
    await supabase.from("wagers").update({ verification_status: "verified" }).eq("id", id);
    // Trigger payout (for now, just log)
    console.log(`Wager ${id} verified. Ready for payout.`);
  }
  ctx.response.body = { status: verification_status, imageUrl };
});

// GET /wager/:id/result-status – get both users' result images and verification status
router.get("/wager/:id/result-status", async (ctx) => {
  const { id } = ctx.params;
  const { data: wager, error: wagerError } = await supabase.from("wagers").select("*").eq("id", id).single();
  if (wagerError || !wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Wager not found" };
    return;
  }
  const { data: results, error: resultsError } = await supabase.from("wager_results").select("user_id,image_url,uploaded_at").eq("wager_id", id);
  if (resultsError) {
    ctx.response.status = 500;
    ctx.response.body = { error: resultsError.message };
    return;
  }
  const userAResult = results?.find(r => r.user_id === wager.user_a) || {};
  const userBResult = results?.find(r => r.user_id === wager.user_b) || {};
  ctx.response.body = {
    userA: { userId: wager.user_a, imageUrl: userAResult.image_url || null, uploadedAt: userAResult.uploaded_at || null },
    userB: { userId: wager.user_b, imageUrl: userBResult.image_url || null, uploadedAt: userBResult.uploaded_at || null },
    verification_status: wager.verification_status || 'pending',
  };
});

// Webhook at /stripe/webhook handling payment_intent.succeeded & payout.paid.
router.post("/stripe/webhook", async (ctx) => {
  const sig = ctx.request.headers.get("stripe-signature");
  const body = await ctx.request.body({ type: "text" }).value;
  
  console.log("Webhook received:", {
    hasSignature: !!sig,
    bodyLength: body.length,
    webhookSecret: STRIPE_WEBHOOK_SECRET ? "Set" : "Not set"
  });
  
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, STRIPE_WEBHOOK_SECRET);
    console.log("Webhook verified successfully:", event.type);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    ctx.response.status = 400;
    ctx.response.body = { error: `Webhook Error: ${err.message}` };
    return;
  }
  
  try {
    if (event.type === "payment_intent.succeeded") {
      console.log("Payment intent succeeded:", event.data.object.id);
      // Optionally, mark payment as complete in wager
      // ...
    } else if (event.type === "payout.paid") {
      console.log("Payout paid:", event.data.object.id);
      // Optionally, mark payout as complete
      // ...
    } else if (event.type === "customer.created") {
      console.log("Customer created:", event.data.object.id);
      // Handle customer creation if needed
    } else if (event.type === "payment_intent.created") {
      console.log("Payment intent created:", event.data.object.id);
      // Handle payment intent creation if needed
    } else if (event.type === "account.updated") {
      console.log("Account updated:", event.data.object.id);
      // Handle KYC/AML status updates
      const account = event.data.object;
      const { data: user, error } = await supabase
        .from("users")
        .select("id")
        .eq("stripe_account_id", account.id)
        .single();
      
      if (user) {
        // Update KYC status based on account requirements
        const kycStatus = account.charges_enabled && account.payouts_enabled ? "verified" : "pending";
        const requirements = account.requirements;
        
        await supabase
          .from("users")
          .update({ 
            kyc_status: kycStatus,
            kyc_requirements: requirements ? JSON.stringify(requirements) : null
          })
          .eq("id", user.id);
        
        console.log(`Updated KYC status for user ${user.id}: ${kycStatus}`);
      }
    }
    ctx.response.body = { received: true };
  } catch (err) {
    console.error("Error processing webhook:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Webhook processing failed" };
  }
});

// GET /user/:id/kyc-status – check user's KYC/AML verification status
router.get("/user/:id/kyc-status", async (ctx) => {
  const { id } = ctx.params;
  
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, stripe_account_id, kyc_status, kyc_requirements")
    .eq("id", id)
    .single();
  
  if (error || !user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  if (!user.stripe_account_id) {
    ctx.response.body = {
      kyc_status: "not_started",
      message: "User has not started KYC onboarding"
    };
    return;
  }
  
  // If we have cached status, return it
  if (user.kyc_status) {
    ctx.response.body = {
      kyc_status: user.kyc_status,
      requirements: user.kyc_requirements ? JSON.parse(user.kyc_requirements) : null
    };
    return;
  }
  
  // Fetch fresh status from Stripe
  try {
    const account = await stripe.accounts.retrieve(user.stripe_account_id);
    const kycStatus = account.charges_enabled && account.payouts_enabled ? "verified" : "pending";
    
    // Update our cache
    await supabase
      .from("users")
      .update({ 
        kyc_status: kycStatus,
        kyc_requirements: account.requirements ? JSON.stringify(account.requirements) : null
      })
      .eq("id", user.id);
    
    ctx.response.body = {
      kyc_status: kycStatus,
      requirements: account.requirements
    };
  } catch (err) {
    console.error("Error fetching KYC status from Stripe:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to fetch KYC status" };
  }
});

// POST /stripe/onboard – onboard a user to Stripe Connect
router.post("/stripe/onboard", async (ctx) => {
  const { userId } = await ctx.request.body({ type: "json" }).value;
  if (!userId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userId" };
    return;
  }
  // Fetch user from DB
  const { data: user, error: userError } = await supabase.from("users").select("*").eq("id", userId).single();
  if (userError || !user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  let stripeAccountId = user.stripe_account_id;
  // If user doesn't have a Stripe account, create one
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "custom",
      country: "US", // You may want to make this dynamic
      email: user.email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      // Add test business information to enable transfers capability
      business_profile: {
        url: "https://example.com",
        mcc: "5734", // Computer Software Stores
        product_description: "Wager platform for gaming competitions",
      },
      company: {
        name: "Test Wager Company",
        phone: "0000000000", // Test phone number from docs
        address: {
          line1: "address_full_match", // Test address token to enable transfers
          city: "San Francisco",
          state: "CA",
          postal_code: "94102",
          country: "US",
        },
        tax_id: "000000000", // Test tax ID from docs
      },
      individual: {
        first_name: "Test",
        last_name: "User",
        email: user.email,
        phone: "0000000000", // Test phone number
        address: {
          line1: "address_full_match", // Test address token
          city: "San Francisco", 
          state: "CA",
          postal_code: "94102",
          country: "US",
        },
        dob: {
          day: 1,
          month: 1,
          year: 1901, // Test DOB from docs for successful verification
        },
        ssn_last_4: "0000", // Test SSN from docs
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "127.0.0.1", // Test IP
      },
    });
    stripeAccountId = account.id;
    // Store in DB
    await supabase.from("users").update({ stripe_account_id: stripeAccountId }).eq("id", userId);
  }
  // Create onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: "https://your-frontend.com/stripe/refresh", // TODO: update to your frontend
    return_url: "https://your-frontend.com/stripe/return",   // TODO: update to your frontend
    type: "account_onboarding",
  });
  ctx.response.body = { onboardingUrl: accountLink.url };
});

// POST /wallet/topup – initiate a Stripe Payment Intent for wallet top-up
router.post("/wallet/topup", async (ctx) => {
  const { userId, amountUsd } = await ctx.request.body({ type: "json" }).value;
  if (!userId || typeof amountUsd !== "number") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userId or amountUsd" };
    return;
  }
  // Fetch user for email (for Stripe customer)
  const { data: user, error: userError } = await supabase.from("users").select("*").eq("id", userId).single();
  if (userError || !user) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  // Create a Stripe Customer if needed (idempotent by email)
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", userId);
  }
  // Create PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    customer: customerId,
    metadata: { userId },
  });
  ctx.response.body = { clientSecret: paymentIntent.client_secret };
});

// POST /wager/:id/lock – lock funds for a wager (move from wallet to escrow)
router.post("/wager/:id/lock", async (ctx) => {
  const { id } = ctx.params;
  const { userId, amountUsd } = await ctx.request.body({ type: "json" }).value;
  if (!userId || typeof amountUsd !== "number") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing userId or amountUsd" };
    return;
  }
  // Fetch user and wager
  const { data: user, error: userError } = await supabase.from("users").select("*").eq("id", userId).single();
  const { data: wager, error: wagerError } = await supabase.from("wagers").select("*").eq("id", id).single();
  if (userError || !user || wagerError || !wager) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User or wager not found" };
    return;
  }
  // For MVP, just create a PaymentIntent for the stake (simulate escrow)
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", userId);
  }
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    customer: customerId,
    metadata: { wagerId: id, userId },
  });
  ctx.response.body = { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
});

// POST /wager/:id/payout – payout to winner (minus house fee)
router.post("/wager/:id/payout", async (ctx) => {
  try {
    const { id } = ctx.params;
    const { winnerUserId } = await ctx.request.body({ type: "json" }).value;
    if (!winnerUserId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Missing winnerUserId" };
      return;
    }
    
    console.log(`Payout request for wager ${id}, winner: ${winnerUserId}`);
    
    // Fetch user and wager
    const { data: user, error: userError } = await supabase.from("users").select("*").eq("id", winnerUserId).single();
    const { data: wager, error: wagerError } = await supabase.from("wagers").select("*").eq("id", id).single();
    
    if (userError || !user) {
      console.error("User fetch error:", userError);
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found" };
      return;
    }
    
    if (wagerError || !wager) {
      console.error("Wager fetch error:", wagerError);
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }
    
    console.log("User data:", { 
      id: user.id, 
      email: user.email, 
      stripe_account_id: user.stripe_account_id,
      stripe_customer_id: user.stripe_customer_id 
    });
    console.log("Wager data:", { 
      id: wager.id, 
      stake_usd: wager.stake_usd, 
      user_a: wager.user_a, 
      user_b: wager.user_b 
    });
    
    if (!user.stripe_account_id) {
      console.error("User missing stripe_account_id");
      ctx.response.status = 400;
      ctx.response.body = { error: "User does not have a Stripe Connect account" };
      return;
    }
    
    // Calculate payout: (stake * 2) - 10% house fee
    const gross = wager.stake_usd * 2;
    const payout = Math.round(gross * 0.9 * 100); // in cents
    
    console.log(`Calculated payout: $${gross} gross, $${payout / 100} net (${payout} cents)`);
    console.log(`Attempting transfer to account: ${user.stripe_account_id}`);
    
    // Transfer to winner's Stripe Connect account
    const transfer = await stripe.transfers.create({
      amount: payout,
      currency: "usd",
      destination: user.stripe_account_id,
      metadata: { wagerId: id },
    });
    
    console.log("Transfer successful:", { 
      transferId: transfer.id, 
      amount: transfer.amount, 
      status: transfer.status 
    });
    
    ctx.response.body = { transferId: transfer.id, payoutUsd: payout / 100 };
    
  } catch (error) {
    console.error("Payout error details:");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error param:", error.param);
    console.error("Error decline_code:", error.decline_code);
    console.error("Full error object:", JSON.stringify(error, null, 2));
    console.error("Stack trace:", error.stack);
    
    ctx.response.status = 500;
    ctx.response.body = { 
      error: "Payout failed", 
      details: error.message,
      code: error.code,
      param: error.param
    };
  }
});

// Wager invitation endpoints
router.post("/wager/invite", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  const { toUserId, stakeUsd, gameType, message } = await ctx.request.body({ type: "json" }).value;
  
  if (!toUserId || !stakeUsd) {
    ctx.response.status = 400;
    ctx.response.body = { error: "toUserId and stakeUsd are required" };
    return;
  }
  
  // Get current user ID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Check if invitation already exists
  const { data: existingInvite } = await supabase
    .from("wager_invitations")
    .select("id")
    .eq("from_user_id", currentUser.id)
    .eq("to_user_id", toUserId)
    .eq("status", "pending")
    .single();
  
  if (existingInvite) {
    ctx.response.status = 409;
    ctx.response.body = { error: "Wager invitation already sent" };
    return;
  }
  
  // Create wager invitation
  const { data: invitation, error } = await supabase
    .from("wager_invitations")
    .insert({
      from_user_id: currentUser.id,
      to_user_id: toUserId,
      stake_usd: Math.round(stakeUsd * 100), // Convert to cents
      game_type: gameType || null,
      message: message || null
    })
    .select()
    .single();
  
  if (error) {
    console.error("Wager invitation error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to send wager invitation" };
    return;
  }
  
  ctx.response.body = { invitation };
});

router.get("/wager/invitations", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  
  // Get current user ID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Get pending invitations (received)
  const { data: receivedInvitations, error: receivedError } = await supabase
    .from("wager_invitations")
    .select(`
      id, stake_usd, game_type, message, created_at, expires_at,
      users!wager_invitations_from_user_id_fkey (
        id, display_name, email, profile_image_url
      )
    `)
    .eq("to_user_id", currentUser.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  
  // Get sent invitations
  const { data: sentInvitations, error: sentError } = await supabase
    .from("wager_invitations")
    .select(`
      id, stake_usd, game_type, message, created_at, expires_at, status,
      users!wager_invitations_to_user_id_fkey (
        id, display_name, email, profile_image_url
      )
    `)
    .eq("from_user_id", currentUser.id)
    .eq("status", "pending");
  
  if (receivedError || sentError) {
    console.error("Invitations fetch error:", receivedError || sentError);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to fetch invitations" };
    return;
  }
  
  ctx.response.body = { 
    received: receivedInvitations,
    sent: sentInvitations
  };
});

router.post("/wager/invite/:invitationId/respond", verifyFirebaseToken, async (ctx) => {
  const firebaseUser = ctx.state.user;
  const { invitationId } = ctx.params;
  const { action } = await ctx.request.body({ type: "json" }).value; // 'accept' or 'decline'
  
  if (!["accept", "decline"].includes(action)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Action must be 'accept' or 'decline'" };
    return;
  }
  
  // Get current user ID
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("firebase_uid", firebaseUser.uid)
    .single();
  
  if (!currentUser) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }
  
  // Update invitation status
  const { data: invitation, error } = await supabase
    .from("wager_invitations")
    .update({ 
      status: action === "accept" ? "accepted" : "declined",
      updated_at: new Date().toISOString()
    })
    .eq("id", invitationId)
    .eq("to_user_id", currentUser.id)
    .eq("status", "pending")
    .select()
    .single();
  
  if (error || !invitation) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Invitation not found or already processed" };
    return;
  }
  
  // If accepted, create the wager
  if (action === "accept") {
    const { data: wager, error: wagerError } = await supabase
      .from("wagers")
      .insert({
        user_a: invitation.from_user_id,
        user_b: invitation.to_user_id,
        stake_usd: invitation.stake_usd,
        status: "pending"
      })
      .select("id")
      .single();
    
    if (wagerError) {
      console.error("Wager creation error:", wagerError);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to create wager" };
      return;
    }
    
    ctx.response.body = { 
      invitation,
      wager: { id: wager.id }
    };
  } else {
    ctx.response.body = { invitation };
  }
});

// --- App ---
const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Wager backend listening on http://localhost:${PORT}`);
await app.listen({ port: PORT }); 