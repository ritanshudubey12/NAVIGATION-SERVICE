import { Pool, PoolClient } from 'pg';
import { readSecret } from '../config/secrets';

export interface PoolOptions {
  host: string;
  port: number;
  database: string;
  max?: number;
}

// pg returns BIGINT (int8) as strings by default, which is exactly what we want.
export function createPool(opts: PoolOptions): Pool {
  return new Pool({
    host: opts.host,
    port: opts.port,
    database: opts.database,
    user: readSecret('db_user'),
    password: readSecret('db_password'),
    max: opts.max ?? 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}

export type Queryable = Pick<Pool, 'query'>;

export async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
