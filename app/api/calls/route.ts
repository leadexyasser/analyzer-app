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
  const publisher = searchParams.get('publisher')
  const targetName = searchParams.get('target_name')
  const callerId = searchParams.get('caller_id')
  const endCallSource = searchParams.get('end_call_source')
  const isDuplicate = searchParams.get('is_duplicate')
  const flags = searchParams.get('flags')?.split(',').filter(Boolean)
  const minScore = searchParams.get('min_score')
  const maxScore = searchParams.get('max_score')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const leadVerdict = searchParams.get('lead_verdict')

  const supabase = createServiceClient()
  let query = supabase
    .from('calls')
    .select(
      'id,ringba_call_id,received_at,call_started_at,duration_seconds,caller_id,target_number,campaign_name,campaign_id,buyer_name,publisher_name,target_id,target_name,end_call_source,is_duplicate,revenue,payout,quality_score,flags,analysis,status,error_message',
      { count: 'exact' }
    )
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (campaign) query = query.ilike('campaign_name', `%${campaign}%`)
  if (buyer) query = query.ilike('buyer_name', `%${buyer}%`)
  if (publisher) query = query.ilike('publisher_name', `%${publisher}%`)
  if (targetName) query = query.ilike('target_name', `%${targetName}%`)
  if (callerId) query = query.ilike('caller_id', `%${callerId}%`)
  if (endCallSource) query = query.ilike('end_call_source', `%${endCallSource}%`)
  if (isDuplicate === 'true') query = query.eq('is_duplicate', true)
  if (isDuplicate === 'false') query = query.eq('is_duplicate', false)
  if (flags?.length) query = query.overlaps('flags', flags)
  if (minScore) query = query.gte('quality_score', Number(minScore))
  if (maxScore) query = query.lte('quality_score', Number(maxScore))
  if (from) query = query.gte('received_at', from)
  if (to) query = query.lte('received_at', to)
  if (leadVerdict) query = (query as any).eq('analysis->>lead_intent->>verdict', leadVerdict)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ calls: data, total: count, page, limit })
}
