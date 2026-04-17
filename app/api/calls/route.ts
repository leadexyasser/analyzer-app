import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit

  const status = searchParams.get('status')
  const campaign = searchParams.get('campaign')
  const buyer = searchParams.get('buyer')
  const flags = searchParams.get('flags')?.split(',').filter(Boolean)
  const minScore = searchParams.get('min_score')
  const maxScore = searchParams.get('max_score')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const supabase = createServiceClient()
  let query = supabase
    .from('calls')
    .select('id,ringba_call_id,received_at,call_started_at,duration_seconds,caller_id,campaign_name,buyer_name,revenue,quality_score,flags,status,error_message', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (campaign) query = query.ilike('campaign_name', `%${campaign}%`)
  if (buyer) query = query.ilike('buyer_name', `%${buyer}%`)
  if (flags?.length) query = query.overlaps('flags', flags)
  if (minScore) query = query.gte('quality_score', Number(minScore))
  if (maxScore) query = query.lte('quality_score', Number(maxScore))
  if (from) query = query.gte('received_at', from)
  if (to) query = query.lte('received_at', to)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ calls: data, total: count, page, limit })
}
