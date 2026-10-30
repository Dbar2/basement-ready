import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(process.env.PGLITE_DIR!);
const r = await db.query<{ n: number; usd: number }>(`SELECT count(*)::int AS n, coalesce(sum(usd), 0)::float AS usd FROM spend`);
console.log(JSON.stringify(r.rows[0]));
await db.close();
