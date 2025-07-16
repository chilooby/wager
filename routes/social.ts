import { Router } from "oak";
import { z } from "zod";
import { getDbClient } from "../db/database.ts";
import { authMiddleware } from "../middleware/auth.ts";

const socialRouter = new Router({ prefix: "/social" });

// Validation schemas
const sendFriendRequestSchema = z.object({
  username: z.string().min(3).max(50),
});

const respondFriendRequestSchema = z.object({
  accept: z.boolean(),
});

const sendWagerRequestSchema = z.object({
  toUserId: z.string().uuid(),
  stakeUsd: z.number().min(1).max(10000),
  message: z.string().max(500).optional(),
});

const respondWagerRequestSchema = z.object({
  accept: z.boolean(),
});

// GET /social/friends - Get user's friends list
socialRouter.get("/friends", authMiddleware, async (ctx) => {
  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  const friends = await client.queryObject`
    SELECT 
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      f.created_at as friends_since,
      f.accepted_at
    FROM friendships f
    JOIN users u ON (
      CASE 
        WHEN f.user_id = ${userId} THEN f.friend_id 
        ELSE f.user_id 
      END = u.id
    )
    WHERE (f.user_id = ${userId} OR f.friend_id = ${userId})
      AND f.status = 'accepted'
    ORDER BY f.accepted_at DESC
  `;

  ctx.response.body = { friends: friends.rows };
});

// GET /social/friends/pending - Get pending friend requests
socialRouter.get("/friends/pending", authMiddleware, async (ctx) => {
  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  // Incoming requests
  const incoming = await client.queryObject`
    SELECT 
      f.id as request_id,
      u.id as user_id,
      u.username,
      u.display_name,
      u.avatar_url,
      f.created_at,
      'incoming' as type
    FROM friendships f
    JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ${userId}
      AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `;

  // Outgoing requests
  const outgoing = await client.queryObject`
    SELECT 
      f.id as request_id,
      u.id as user_id,
      u.username,
      u.display_name,
      u.avatar_url,
      f.created_at,
      'outgoing' as type
    FROM friendships f
    JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ${userId}
      AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `;

  ctx.response.body = {
    incoming: incoming.rows,
    outgoing: outgoing.rows,
  };
});

// POST /social/friends/request - Send friend request
socialRouter.post("/friends/request", authMiddleware, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const data = sendFriendRequestSchema.parse(body);
    const userId = ctx.state.user!.id;

    const client = await getDbClient();

    // Find target user
    const targetUser = await client.queryObject<{ id: string }>`
      SELECT id FROM users WHERE username = ${data.username}
    `;

    if (targetUser.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found" };
      return;
    }

    const friendId = targetUser.rows[0].id;

    if (friendId === userId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Cannot send friend request to yourself" };
      return;
    }

    // Check if friendship already exists
    const existing = await client.queryObject`
      SELECT id, status FROM friendships 
      WHERE (user_id = ${userId} AND friend_id = ${friendId})
         OR (user_id = ${friendId} AND friend_id = ${userId})
    `;

    if (existing.rows.length > 0) {
      const status = (existing.rows[0] as any).status;
      ctx.response.status = 409;
      ctx.response.body = { 
        error: status === 'accepted' 
          ? "You are already friends with this user" 
          : "Friend request already exists" 
      };
      return;
    }

    // Create friend request
    await client.queryArray`
      INSERT INTO friendships (user_id, friend_id, status)
      VALUES (${userId}, ${friendId}, 'pending')
    `;

    ctx.response.body = { message: "Friend request sent successfully" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Friend request error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to send friend request" };
    }
  }
});

// POST /social/friends/respond/:requestId - Accept/decline friend request
socialRouter.post("/friends/respond/:requestId", authMiddleware, async (ctx) => {
  try {
    const requestId = ctx.params.requestId;
    const body = await ctx.request.body({ type: "json" }).value;
    const data = respondFriendRequestSchema.parse(body);
    const userId = ctx.state.user!.id;

    const client = await getDbClient();

    // Verify request exists and user is the recipient
    const request = await client.queryObject`
      SELECT id, user_id, friend_id 
      FROM friendships 
      WHERE id = ${requestId} 
        AND friend_id = ${userId}
        AND status = 'pending'
    `;

    if (request.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Friend request not found" };
      return;
    }

    if (data.accept) {
      // Accept friend request
      await client.queryArray`
        UPDATE friendships 
        SET status = 'accepted', accepted_at = NOW()
        WHERE id = ${requestId}
      `;
      ctx.response.body = { message: "Friend request accepted" };
    } else {
      // Decline friend request (delete it)
      await client.queryArray`
        DELETE FROM friendships WHERE id = ${requestId}
      `;
      ctx.response.body = { message: "Friend request declined" };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Friend response error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to respond to friend request" };
    }
  }
});

// DELETE /social/friends/:friendId - Remove friend
socialRouter.delete("/friends/:friendId", authMiddleware, async (ctx) => {
  const friendId = ctx.params.friendId;
  const userId = ctx.state.user!.id;

  const client = await getDbClient();

  const result = await client.queryArray`
    DELETE FROM friendships 
    WHERE ((user_id = ${userId} AND friend_id = ${friendId})
        OR (user_id = ${friendId} AND friend_id = ${userId}))
      AND status = 'accepted'
  `;

  if (result.rowCount === 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Friend not found" };
    return;
  }

  ctx.response.body = { message: "Friend removed successfully" };
});

// GET /social/wager-requests - Get pending wager requests
socialRouter.get("/wager-requests", authMiddleware, async (ctx) => {
  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  // Incoming wager requests
  const incoming = await client.queryObject`
    SELECT 
      wr.id,
      wr.stake_usd,
      wr.message,
      wr.created_at,
      wr.expires_at,
      u.id as from_user_id,
      u.username as from_username,
      u.display_name as from_display_name,
      u.avatar_url as from_avatar_url,
      'incoming' as type
    FROM wager_requests wr
    JOIN users u ON wr.from_user_id = u.id
    WHERE wr.to_user_id = ${userId}
      AND wr.status = 'pending'
      AND wr.expires_at > NOW()
    ORDER BY wr.created_at DESC
  `;

  // Outgoing wager requests
  const outgoing = await client.queryObject`
    SELECT 
      wr.id,
      wr.stake_usd,
      wr.message,
      wr.created_at,
      wr.expires_at,
      u.id as to_user_id,
      u.username as to_username,
      u.display_name as to_display_name,
      u.avatar_url as to_avatar_url,
      'outgoing' as type
    FROM wager_requests wr
    JOIN users u ON wr.to_user_id = u.id
    WHERE wr.from_user_id = ${userId}
      AND wr.status = 'pending'
      AND wr.expires_at > NOW()
    ORDER BY wr.created_at DESC
  `;

  ctx.response.body = {
    incoming: incoming.rows,
    outgoing: outgoing.rows,
  };
});

// POST /social/wager-requests - Send wager request
socialRouter.post("/wager-requests", authMiddleware, async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    const data = sendWagerRequestSchema.parse(body);
    const userId = ctx.state.user!.id;

    const client = await getDbClient();

    // Verify users are friends
    const friendship = await client.queryObject`
      SELECT id FROM friendships
      WHERE ((user_id = ${userId} AND friend_id = ${data.toUserId})
          OR (user_id = ${data.toUserId} AND friend_id = ${userId}))
        AND status = 'accepted'
    `;

    if (friendship.rows.length === 0) {
      ctx.response.status = 403;
      ctx.response.body = { error: "You can only send wager requests to friends" };
      return;
    }

    // Check for existing pending request between users
    const existing = await client.queryObject`
      SELECT id FROM wager_requests
      WHERE ((from_user_id = ${userId} AND to_user_id = ${data.toUserId})
          OR (from_user_id = ${data.toUserId} AND to_user_id = ${userId}))
        AND status = 'pending'
        AND expires_at > NOW()
    `;

    if (existing.rows.length > 0) {
      ctx.response.status = 409;
      ctx.response.body = { error: "A pending wager request already exists between you and this user" };
      return;
    }

    // Create wager request
    const result = await client.queryObject<{ id: string }>`
      INSERT INTO wager_requests (from_user_id, to_user_id, stake_usd, message)
      VALUES (${userId}, ${data.toUserId}, ${data.stakeUsd}, ${data.message || null})
      RETURNING id
    `;

    ctx.response.body = { 
      requestId: result.rows[0].id,
      message: "Wager request sent successfully" 
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Wager request error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to send wager request" };
    }
  }
});

// POST /social/wager-requests/respond/:requestId - Accept/decline wager request
socialRouter.post("/wager-requests/respond/:requestId", authMiddleware, async (ctx) => {
  try {
    const requestId = ctx.params.requestId;
    const body = await ctx.request.body({ type: "json" }).value;
    const data = respondWagerRequestSchema.parse(body);
    const userId = ctx.state.user!.id;

    const client = await getDbClient();

    // Verify request exists and user is the recipient
    const request = await client.queryObject<{
      id: string;
      from_user_id: string;
      stake_usd: number;
    }>`
      SELECT id, from_user_id, stake_usd
      FROM wager_requests 
      WHERE id = ${requestId} 
        AND to_user_id = ${userId}
        AND status = 'pending'
        AND expires_at > NOW()
    `;

    if (request.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager request not found or expired" };
      return;
    }

    const wagerRequest = request.rows[0];

    if (data.accept) {
      // Accept wager request - create wager
      const wagerResult = await client.queryObject<{ id: string }>`
        INSERT INTO wagers (user_a_id, user_b_id, stake_usd, status, accepted_at)
        VALUES (${wagerRequest.from_user_id}, ${userId}, ${wagerRequest.stake_usd}, 'accepted', NOW())
        RETURNING id
      `;

      // Update wager request status
      await client.queryArray`
        UPDATE wager_requests 
        SET status = 'accepted', responded_at = NOW()
        WHERE id = ${requestId}
      `;

      ctx.response.body = { 
        wagerId: wagerResult.rows[0].id,
        message: "Wager request accepted" 
      };
    } else {
      // Decline wager request
      await client.queryArray`
        UPDATE wager_requests 
        SET status = 'declined', responded_at = NOW()
        WHERE id = ${requestId}
      `;
      ctx.response.body = { message: "Wager request declined" };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid input", details: error.errors };
    } else {
      console.error("Wager response error:", error);
      ctx.response.status = 500;
      ctx.response.body = { error: "Failed to respond to wager request" };
    }
  }
});

// GET /social/search - Search for users
socialRouter.get("/search", authMiddleware, async (ctx) => {
  const query = ctx.request.url.searchParams.get("q");
  
  if (!query || query.length < 2) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Search query must be at least 2 characters" };
    return;
  }

  const userId = ctx.state.user!.id;
  const client = await getDbClient();

  const users = await client.queryObject`
    SELECT 
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      CASE 
        WHEN f.id IS NOT NULL THEN f.status
        ELSE NULL
      END as friendship_status
    FROM users u
    LEFT JOIN friendships f ON 
      ((f.user_id = ${userId} AND f.friend_id = u.id) OR
       (f.user_id = u.id AND f.friend_id = ${userId}))
    WHERE u.id != ${userId}
      AND (u.username ILIKE ${'%' + query + '%'} 
           OR u.display_name ILIKE ${'%' + query + '%'})
    LIMIT 20
  `;

  ctx.response.body = { users: users.rows };
});

export { socialRouter };