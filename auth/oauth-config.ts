// OAuth provider configurations
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

export const oauthConfigs: Record<string, OAuthConfig> = {
  twitch: {
    clientId: Deno.env.get("TWITCH_CLIENT_ID") || "",
    clientSecret: Deno.env.get("TWITCH_CLIENT_SECRET") || "",
    redirectUri: Deno.env.get("TWITCH_REDIRECT_URI") || "http://localhost:8000/auth/callback/twitch",
    authorizationUrl: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    userInfoUrl: "https://api.twitch.tv/helix/users",
    scopes: ["user:read:email"],
  },
  xbox: {
    clientId: Deno.env.get("XBOX_CLIENT_ID") || "",
    clientSecret: Deno.env.get("XBOX_CLIENT_SECRET") || "",
    redirectUri: Deno.env.get("XBOX_REDIRECT_URI") || "http://localhost:8000/auth/callback/xbox",
    authorizationUrl: "https://login.live.com/oauth20_authorize.srf",
    tokenUrl: "https://login.live.com/oauth20_token.srf",
    userInfoUrl: "https://apis.live.net/v5.0/me",
    scopes: ["wl.basic", "wl.emails", "xbox.profile"],
  },
  psn: {
    // PSN OAuth is more complex and requires special developer access
    // This is a placeholder configuration
    clientId: Deno.env.get("PSN_CLIENT_ID") || "",
    clientSecret: Deno.env.get("PSN_CLIENT_SECRET") || "",
    redirectUri: Deno.env.get("PSN_REDIRECT_URI") || "http://localhost:8000/auth/callback/psn",
    authorizationUrl: "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize",
    tokenUrl: "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token",
    userInfoUrl: "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/userinfo",
    scopes: ["psn:s2s"],
  },
  steam: {
    // Steam uses OpenID, not OAuth2, so this is a simplified config
    clientId: Deno.env.get("STEAM_API_KEY") || "",
    clientSecret: "", // Steam doesn't use client secret
    redirectUri: Deno.env.get("STEAM_REDIRECT_URI") || "http://localhost:8000/auth/callback/steam",
    authorizationUrl: "https://steamcommunity.com/openid/login",
    tokenUrl: "", // Steam OpenID doesn't have a token endpoint
    userInfoUrl: "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    scopes: [],
  },
};

// Generate OAuth authorization URL
export function getAuthorizationUrl(provider: string, state: string): string {
  const config = oauthConfigs[provider];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }

  if (provider === "steam") {
    // Steam uses OpenID
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": config.redirectUri,
      "openid.realm": new URL(config.redirectUri).origin,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return `${config.authorizationUrl}?${params}`;
  }

  // Standard OAuth2 flow
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });

  return `${config.authorizationUrl}?${params}`;
}