import fs from 'fs';
import path from 'path';
import { createPool } from './pool';

// Run as a one-off deployment job (compose service "migrate"), not from every API replica.
async function main() {
  const pool = createPool({
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'navigation',
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('migrations up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
