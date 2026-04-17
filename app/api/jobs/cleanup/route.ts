import { NextRequest, NextResponse } from 'next/server'
import { deleteOldRecordings } from '@/lib/storage'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deleted = await deleteOldRecordings(30)
  return NextResponse.json({ ok: true, deleted_files: deleted })
}
