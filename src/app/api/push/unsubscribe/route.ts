import { NextResponse } from 'next/server'
import { removeSubscription } from '@/lib/push-store'

export async function POST(request: Request) {
  const body: { endpoint?: string } = await request.json()

  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  removeSubscription(body.endpoint)
  return NextResponse.json({ ok: true })
}
