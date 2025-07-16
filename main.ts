// main.ts
import { Application, Router, Context } from "oak";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import Stripe from "stripe";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// --- ENV ---
const PORT = Number(Deno.env.get("PORT") || 8000);
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_xxx";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "whsec_xxx";
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16", httpClient: Stripe.createFetchHttpClient() });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_STORAGE_BUCKET = Deno.env.get("SUPABASE_STORAGE_BUCKET") || "wager-results";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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