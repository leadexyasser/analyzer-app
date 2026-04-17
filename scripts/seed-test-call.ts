/**
 * Seed a test call into the pipeline.
 * Usage: npx tsx scripts/seed-test-call.ts
 *
 * Requires .env.local to be present with valid credentials.
 */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const BASE_URL = process.env.APP_URL ?? 'http://localhost:3000'

async function main() {
  const payload = await import('../fixtures/ringba-sample.json', { assert: { type: 'json' } })

  console.log(`Seeding test call to ${BASE_URL}/api/webhooks/ringba ...`)
  const res = await fetch(`${BASE_URL}/api/webhooks/ringba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload.default),
  })

  const data = await res.json()
  console.log(`Response [${res.status}]:`, JSON.stringify(data, null, 2))

  if (data.call_id) {
    console.log(`\nCall created: ${BASE_URL}/dashboard/calls/${data.call_id}`)
    console.log(`\nTrigger job processing:`)
    console.log(`  curl -X POST ${BASE_URL}/api/jobs/process -H "Authorization: Bearer <CRON_SECRET>"`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
