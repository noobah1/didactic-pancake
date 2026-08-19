import { NextResponse } from 'next/server'
import { migrateSubscription } from '@/lib/push-store'
import type { PushSubscription as WebPushSubscription } from 'web-push'

interface ResubscribeBody {
  oldEndpoint?: string
  subscription: WebPushSubscription
}

// Hit by the service worker's pushsubscriptionchange handler, not by the
// page — the browser can rotate a subscription's endpoint at any time, and
// this carries the new one over to the existing server-side record (see
// migrateSubscription) instead of leaving it pointed at a dead endpoint.
export async function POST(request: Request) {
  const body: ResubscribeBody = await request.json()

  if (!body.subscription?.endpoint || !body.subscription?.keys) {
    return NextResponse.json({ error: 'subscription is required' }, { status: 400 })
  }

  migrateSubscription(body.oldEndpoint, body.subscription)
  return NextResponse.json({ ok: true })
}
