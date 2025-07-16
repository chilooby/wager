import { Client } from "postgres";

// Database client singleton
let dbClient: Client | null = null;

export async function getDbClient(): Promise<Client> {
  if (!dbClient) {
    dbClient = new Client({
      hostname: Deno.env.get("DB_HOST") || "localhost",
      port: Number(Deno.env.get("DB_PORT") || 5432),
      user: Deno.env.get("DB_USER") || "postgres",
      password: Deno.env.get("DB_PASSWORD") || "postgres",
      database: Deno.env.get("DB_NAME") || "wager_db",
    });
    await dbClient.connect();
  }
  return dbClient;
}

export async function initDatabase() {
  const client = await getDbClient();
  
  // Read and execute schema
  const schema = await Deno.readTextFile("./db/schema.sql");
  await client.queryArray(schema);
  
  console.log("Database initialized successfully");
}

export async function closeDatabase() {
  if (dbClient) {
    await dbClient.end();
    dbClient = null;
  }
}