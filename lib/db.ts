import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  return new Pool({
    connectionString,
    // Traffic is TLS-encrypted, but the droplet uses a self-signed cert. Skip CA verification —
    // scram-sha-256 password auth is still mutual, so a MITM can't impersonate the server.
    ssl: { rejectUnauthorized: false },
    // Vercel serverless: tiny pool per invocation.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

// Reuse pool across HMR / warm serverless invocations.
export const pool: Pool = global.__pgPool ?? (global.__pgPool = makePool())

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as any[])
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const r = await pool.query<T>(text, params as any[])
  return r.rows[0] ?? null
}

export async function many<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const r = await pool.query<T>(text, params as any[])
  return r.rows
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
