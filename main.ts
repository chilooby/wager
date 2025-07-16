// main.ts
import { Application, Router } from "oak";
import { createClient } from "supabase";
import "dotenv";
import Stripe from "stripe";

// Import routes
import authRouter from "./routes/auth.ts";
import wagersRouter from "./routes/wagers.ts";
import paymentsRouter from "./routes/payments.ts";

// Import middleware
import { authMiddleware } from "./middleware/auth.ts";

// Environment variables
const PORT = Number(Deno.env.get("PORT") || 8000);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Initialize Stripe
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
  httpClient: Stripe.createFetchHttpClient(),
});

// Create Oak application
const app = new Application();

// Add state to context
app.use((ctx, next) => {
  ctx.state.supabase = supabase;
  ctx.state.stripe = stripe;
  return next();
});

// Add auth middleware
app.use(authMiddleware);

// Health check route
const healthRouter = new Router();
healthRouter.get("/health", (ctx) => {
  ctx.response.body = { 
    status: "ok", 
    timestamp: new Date().toISOString(),
    environment: {
      supabase: !!SUPABASE_URL,
      stripe: !!STRIPE_SECRET_KEY,
    }
  };
});

// Apply routes
app.use(healthRouter.routes());
app.use(healthRouter.allowedMethods());
app.use(authRouter.routes());
app.use(authRouter.allowedMethods());
app.use(wagersRouter.routes());
app.use(wagersRouter.allowedMethods());
app.use(paymentsRouter.routes());
app.use(paymentsRouter.allowedMethods());

// Error handling middleware
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
    ctx.response.status = err.status || 500;
    ctx.response.body = {
      error: err.message || "Internal server error",
    };
  }
});

// 404 handler
app.use((ctx) => {
  ctx.response.status = 404;
  ctx.response.body = { error: "Not found" };
});

// Start server
console.log(`🚀 Wager API server running on http://localhost:${PORT}`);
console.log(`📦 Environment: ${Deno.env.get("DENO_ENV") || "development"}`);
console.log(`🔌 Supabase: ${SUPABASE_URL ? "Connected" : "Not configured"}`);
console.log(`💳 Stripe: ${STRIPE_SECRET_KEY ? "Connected" : "Not configured"}`);

await app.listen({ port: PORT }); 