import { Context, Next } from "oak";

export async function authMiddleware(ctx: Context, next: Next) {
  try {
    const authorization = ctx.request.headers.get("Authorization");
    
    if (!authorization) {
      await next();
      return;
    }

    const token = authorization.replace("Bearer ", "");
    const supabase = ctx.state.supabase;
    
    // Verify JWT token
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (!error && user) {
      ctx.state.user = user;
    }
    
    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    await next();
  }
}