// Applies ./drizzle/*.sql in lexical order, tracking applied files in
// _migrations. Uses only `pg` (already shipped with the standalone build), so
// containers never need drizzle-kit or devDependencies.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const DRIZZLE_DIR = process.env.DRIZZLE_DIR ?? "drizzle";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await pool.query("SELECT name FROM _migrations");
  const applied = new Set(rows.map((r) => r.name));

  const files = readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error(`no .sql files found in ${DRIZZLE_DIR}`);

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} already applied`);
      continue;
    }
    const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8");
    console.log(`→ applying ${file}`);
    await pool.query(sql);
    await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }
  console.log("migrations up to date");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
