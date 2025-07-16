import { Router, Context } from "oak";
import { createClient } from "supabase";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const router = new Router();

// Sign up
router.post("/auth/signup", async (ctx: Context) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const { email, password, username } = body;

    if (!email || !password || !username) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Email, password, and username are required" };
      return;
    }

    const supabase = ctx.state.supabase;
    
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      ctx.response.status = 400;
      ctx.response.body = { error: authError.message };
      return;
    }

    // Create user profile
    const { error: profileError } = await supabase
      .from("users")
      .insert({
        id: authData.user!.id,
        email,
        username,
      });

    if (profileError) {
      ctx.response.status = 400;
      ctx.response.body = { error: profileError.message };
      return;
    }

    ctx.response.body = {
      user: authData.user,
      session: authData.session,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Sign in
router.post("/auth/signin", async (ctx: Context) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const { email, password } = body;

    if (!email || !password) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Email and password are required" };
      return;
    }

    const supabase = ctx.state.supabase;
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      ctx.response.status = 401;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = {
      user: data.user,
      session: data.session,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Sign out
router.post("/auth/signout", async (ctx: Context) => {
  try {
    const authorization = ctx.request.headers.get("Authorization");
    if (!authorization) {
      ctx.response.status = 401;
      ctx.response.body = { error: "No authorization header" };
      return;
    }

    const supabase = ctx.state.supabase;
    const { error } = await supabase.auth.signOut();

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { message: "Successfully signed out" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Get current user
router.get("/auth/me", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const supabase = ctx.state.supabase;
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { user: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

export default router;