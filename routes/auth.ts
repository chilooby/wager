import { Router } from "oak";
import { z } from "zod";
import { getDbClient } from "../db/database.ts";
import { getFirebaseAuth, createCustomToken } from "../auth/firebase.ts";
import { oauthConfigs, getAuthorizationUrl } from "../auth/oauth-config.ts";
import { authMiddleware } from "../middleware/auth.ts";

const authRouter = new Router({ prefix: "/auth" });

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  displayName: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  idToken: z.string(), // Firebase ID token from client
});

// POST /auth/register - Register new user
authRouter.post("/register", async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const data = registerSchema.parse(body);

    const client = await getDbClient();

    // Check if user already exists
    const existing = await client.queryObject`
      SELECT id FROM users WHERE email = ${data.email} OR username = ${data.username}
    `;

    if (existing.rows.length > 0) {
      ctx.response.status = 409;
      ctx.response.body = { error: "User with this email or username already exists" };
      return;
    }

    // Create user in database
    const result = await client.queryObject<{ id: string }>`
      INSERT INTO users (email, username, display_name)
      VALUES (${data.email}, ${data.username}, ${data.displayName || data.username})
      RETURNING id
    `;

    const userId = result.rows[0].id;

    // Create Firebase user
    const auth = getFirebaseAuth();
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({
        email: data.email,
        displayName: data.displayName || data.username,
      });
    } catch (error: any) {
      // If Firebase user creation fails, delete the database user
      await client.queryArray`DELETE FROM users WHERE id = ${userId}`;
      throw error;
    }

    // Create custom token for immediate login
    const customToken = await createCustomToken(firebaseUser.uid);

    ctx.response.body = {
      userId,
      customToken,
      message: "User registered successfully",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Registration error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Registration failed" };
    }
  }
});

// POST /auth/login - Login with Firebase ID token
authRouter.post("/login", async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const data = loginSchema.parse(body);

    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(data.idToken);

    const client = await getDbClient();
    const result = await client.queryObject<{ id: string; username: string }>`
      SELECT id, username, display_name, avatar_url
      FROM users
      WHERE email = ${decodedToken.email}
    `;

    if (result.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found. Please register first." };
      return;
    }

    ctx.response.body = {
      user: result.rows[0],
      firebaseUid: decodedToken.uid,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Login error:", error);
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid token" };
    }
  }
});

// GET /auth/oauth/:provider - Initiate OAuth flow
authRouter.get("/oauth/:provider", (ctx) => {
  const provider = ctx.params.provider;
  const validProviders = ["twitch", "xbox", "psn", "steam"];

  if (!validProviders.includes(provider)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Invalid OAuth provider" };
    return;
  }

  // Generate state token for CSRF protection
  const state = crypto.randomUUID();
  
  // Store state in session/cookie (simplified for demo)
  ctx.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "lax" });
  ctx.cookies.set("oauth_provider", provider, { httpOnly: true, sameSite: "lax" });

  try {
    const authUrl = getAuthorizationUrl(provider, state);
    ctx.response.redirect(authUrl);
  } catch (error) {
    console.error("OAuth init error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to initialize OAuth flow" };
  }
});

// GET /auth/callback/:provider - OAuth callback
authRouter.get("/callback/:provider", async (ctx) => {
  const provider = ctx.params.provider;
  const code = ctx.request.url.searchParams.get("code");
  const state = ctx.request.url.searchParams.get("state");
  const storedState = await ctx.cookies.get("oauth_state");
  const storedProvider = await ctx.cookies.get("oauth_provider");

  // Validate state and provider
  if (!code || state !== storedState || provider !== storedProvider) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Invalid OAuth callback" };
    return;
  }

  // Clear OAuth cookies
  ctx.cookies.delete("oauth_state");
  ctx.cookies.delete("oauth_provider");

  try {
    const config = oauthConfigs[provider];
    
    // Exchange code for access token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info from provider
    let userInfo: any = {};
    if (provider === "twitch") {
      const userResponse = await fetch(config.userInfoUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Client-Id": config.clientId,
        },
      });
      const data = await userResponse.json();
      userInfo = data.data[0];
    } else {
      const userResponse = await fetch(config.userInfoUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      });
      userInfo = await userResponse.json();
    }

    // Extract user data based on provider
    const providerData = {
      twitch: {
        id: userInfo.id,
        username: userInfo.login,
        email: userInfo.email,
        displayName: userInfo.display_name,
        avatarUrl: userInfo.profile_image_url,
      },
      xbox: {
        id: userInfo.id,
        username: userInfo.emails?.preferred || userInfo.id,
        email: userInfo.emails?.preferred,
        displayName: userInfo.name,
        avatarUrl: null,
      },
      // Add mappings for PSN and Steam when available
    }[provider] || {};

    const client = await getDbClient();

    // Check if OAuth account already linked
    const existingOAuth = await client.queryObject`
      SELECT user_id FROM oauth_providers 
      WHERE provider = ${provider} AND provider_id = ${providerData.id}
    `;

    let userId: string;
    
    if (existingOAuth.rows.length > 0) {
      // User already exists, just log them in
      userId = (existingOAuth.rows[0] as any).user_id;
    } else {
      // Create new user or link to existing
      const existingUser = await client.queryObject<{ id: string }>`
        SELECT id FROM users WHERE email = ${providerData.email}
      `;

      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
      } else {
        // Create new user
        const newUser = await client.queryObject<{ id: string }>`
          INSERT INTO users (email, username, display_name, avatar_url)
          VALUES (
            ${providerData.email}, 
            ${providerData.username}, 
            ${providerData.displayName},
            ${providerData.avatarUrl}
          )
          RETURNING id
        `;
        userId = newUser.rows[0].id;
      }

      // Link OAuth provider
      await client.queryArray`
        INSERT INTO oauth_providers (user_id, provider, provider_id, provider_username, access_token)
        VALUES (${userId}, ${provider}, ${providerData.id}, ${providerData.username}, ${accessToken})
      `;
    }

    // Create custom token for the user
    const customToken = await createCustomToken(userId, { provider });

    // Redirect to frontend with token
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
    ctx.response.redirect(`${frontendUrl}/auth/callback?token=${customToken}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "OAuth authentication failed" };
  }
});

// POST /auth/link/:provider - Link OAuth provider to existing account
authRouter.post("/link/:provider", authMiddleware, async (ctx) => {
  const provider = ctx.params.provider;
  const validProviders = ["twitch", "xbox", "psn", "steam"];

  if (!validProviders.includes(provider)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Invalid OAuth provider" };
    return;
  }

  // Store user ID in session for linking after OAuth flow
  ctx.cookies.set("link_user_id", ctx.state.user!.id, { httpOnly: true, sameSite: "lax" });
  
  // Redirect to OAuth flow
  ctx.response.redirect(`/auth/oauth/${provider}`);
});

export { authRouter };