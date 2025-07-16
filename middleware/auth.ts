import { Context, Next } from "oak";
import { verifyIdToken } from "../auth/firebase.ts";
import { getDbClient } from "../db/database.ts";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  firebaseUid: string;
}

// Extend Oak's context to include user
declare module "oak" {
  interface State {
    user?: AuthUser;
  }
}

// Authentication middleware
export async function authMiddleware(ctx: Context, next: Next) {
  const authHeader = ctx.request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Missing or invalid Authorization header" };
    return;
  }

  const idToken = authHeader.substring(7);
  const decodedToken = await verifyIdToken(idToken);
  
  if (!decodedToken) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid or expired token" };
    return;
  }

  // Get user from database
  const client = await getDbClient();
  const result = await client.queryObject<AuthUser>`
    SELECT 
      id,
      email,
      username,
      display_name as "displayName",
      avatar_url as "avatarUrl"
    FROM users 
    WHERE email = ${decodedToken.email}
  `;

  if (result.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "User not found" };
    return;
  }

  // Attach user to context state
  ctx.state.user = {
    ...result.rows[0],
    firebaseUid: decodedToken.uid,
  };

  await next();
}

// Optional auth middleware (doesn't fail if no token)
export async function optionalAuthMiddleware(ctx: Context, next: Next) {
  const authHeader = ctx.request.headers.get("Authorization");
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.substring(7);
    const decodedToken = await verifyIdToken(idToken);
    
    if (decodedToken) {
      const client = await getDbClient();
      const result = await client.queryObject<AuthUser>`
        SELECT 
          id,
          email,
          username,
          display_name as "displayName",
          avatar_url as "avatarUrl"
        FROM users 
        WHERE email = ${decodedToken.email}
      `;

      if (result.rows.length > 0) {
        ctx.state.user = {
          ...result.rows[0],
          firebaseUid: decodedToken.uid,
        };
      }
    }
  }

  await next();
}