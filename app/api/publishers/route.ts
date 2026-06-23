import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('calls')
    .select('publisher_name')
    .limit(5000)

  if (error || !data) {
    return NextResponse.json({ publishers: [] })
  }

  const unique = [
    ...new Set(
      (data as { publisher_name: string | null }[])
        .map(r => r.publisher_name)
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    ),
  ].sort()

  return NextResponse.json({ publishers: unique })
}
