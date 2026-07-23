import "server-only";

import { Pool } from "pg";

declare global {
  var sabcPostgresPool: Pool | undefined;
}

export function getPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  globalThis.sabcPostgresPool ??= new Pool({ connectionString });
  return globalThis.sabcPostgresPool;
}
