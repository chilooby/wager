#!/usr/bin/env deno run --allow-env --allow-read --allow-net

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { initDatabase, closeDatabase } from "../db/database.ts";

console.log("🚀 Initializing Wager database...");

try {
  await initDatabase();
  console.log("✅ Database initialized successfully!");
  console.log("\nDatabase tables created:");
  console.log("  - users");
  console.log("  - oauth_providers");
  console.log("  - friendships");
  console.log("  - wagers");
  console.log("  - wager_payments");
  console.log("  - wager_requests");
  console.log("\n📝 Remember to configure your .env file with the correct database credentials.");
} catch (error) {
  console.error("❌ Failed to initialize database:", error.message);
  console.error("\nMake sure:");
  console.error("  1. PostgreSQL is running");
  console.error("  2. Database 'wager_db' exists (create with: createdb wager_db)");
  console.error("  3. Your .env file has correct DB_* variables");
  Deno.exit(1);
} finally {
  await closeDatabase();
}

console.log("\n✨ Database setup complete!");