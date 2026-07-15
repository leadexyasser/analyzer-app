import { NextResponse } from 'next/server'
import { many } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const rows = await many<{ publisher_name: string }>(
      `SELECT DISTINCT publisher_name
       FROM calls
       WHERE publisher_name IS NOT NULL AND publisher_name <> ''
       ORDER BY publisher_name ASC`
    )
    return NextResponse.json({ publishers: rows.map(r => r.publisher_name) })
  } catch {
    return NextResponse.json({ publishers: [] })
  }
}
