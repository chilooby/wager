import { Router, Context } from "oak";

const router = new Router();

// Create wager
router.post("/wagers", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const body = await ctx.request.body({ type: "json" }).value;
    const { participantBId, amount, description } = body;

    if (!participantBId || !amount) {
      ctx.response.status = 400;
      ctx.response.body = { error: "participantBId and amount are required" };
      return;
    }

    if (amount <= 0) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Amount must be greater than 0" };
      return;
    }

    const supabase = ctx.state.supabase;
    
    // Create wager
    const { data, error } = await supabase
      .from("wagers")
      .insert({
        participant_a_id: user.id,
        participant_b_id: participantBId,
        amount,
        description,
      })
      .select()
      .single();

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { wager: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Get all wagers for user
router.get("/wagers", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const supabase = ctx.state.supabase;
    const status = ctx.request.url.searchParams.get("status");
    
    let query = supabase
      .from("wagers")
      .select(`
        *,
        participant_a:participant_a_id(id, username, email),
        participant_b:participant_b_id(id, username, email),
        winner:winner_id(id, username, email)
      `)
      .or(`participant_a_id.eq.${user.id},participant_b_id.eq.${user.id}`);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { wagers: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Get single wager
router.get("/wagers/:id", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const { id } = ctx.params;
    const supabase = ctx.state.supabase;
    
    const { data, error } = await supabase
      .from("wagers")
      .select(`
        *,
        participant_a:participant_a_id(id, username, email),
        participant_b:participant_b_id(id, username, email),
        winner:winner_id(id, username, email),
        transactions(*)
      `)
      .eq("id", id)
      .single();

    if (error) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }

    // Check if user is participant
    if (data.participant_a_id !== user.id && data.participant_b_id !== user.id) {
      ctx.response.status = 403;
      ctx.response.body = { error: "Not authorized to view this wager" };
      return;
    }

    ctx.response.body = { wager: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Accept/Reject wager (participant B)
router.patch("/wagers/:id/respond", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const { id } = ctx.params;
    const body = await ctx.request.body({ type: "json" }).value;
    const { accept } = body;

    const supabase = ctx.state.supabase;
    
    // Get wager
    const { data: wager, error: wagerError } = await supabase
      .from("wagers")
      .select("*")
      .eq("id", id)
      .single();

    if (wagerError) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }

    // Check if user is participant B
    if (wager.participant_b_id !== user.id) {
      ctx.response.status = 403;
      ctx.response.body = { error: "Only participant B can respond to wager" };
      return;
    }

    // Check if wager is pending
    if (wager.status !== "pending") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Wager is not pending" };
      return;
    }

    // Update wager status
    const newStatus = accept ? "active" : "cancelled";
    const { data, error } = await supabase
      .from("wagers")
      .update({ status: newStatus })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    ctx.response.body = { wager: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Settle wager (declare winner)
router.post("/wagers/:id/settle", async (ctx: Context) => {
  try {
    const user = ctx.state.user;
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Not authenticated" };
      return;
    }

    const { id } = ctx.params;
    const body = await ctx.request.body({ type: "json" }).value;
    const { winnerId } = body;

    const supabase = ctx.state.supabase;
    
    // Get wager
    const { data: wager, error: wagerError } = await supabase
      .from("wagers")
      .select("*")
      .eq("id", id)
      .single();

    if (wagerError) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Wager not found" };
      return;
    }

    // Check if user is participant
    if (wager.participant_a_id !== user.id && wager.participant_b_id !== user.id) {
      ctx.response.status = 403;
      ctx.response.body = { error: "Only participants can settle wager" };
      return;
    }

    // Check if wager is active
    if (wager.status !== "active") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Wager is not active" };
      return;
    }

    // Validate winner is participant
    if (winnerId !== wager.participant_a_id && winnerId !== wager.participant_b_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Winner must be a participant" };
      return;
    }

    // Update wager
    const { data, error } = await supabase
      .from("wagers")
      .update({
        status: "completed",
        winner_id: winnerId,
        settled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }

    // Create payout transaction (handled by payments route)
    
    ctx.response.body = { wager: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

export default router;