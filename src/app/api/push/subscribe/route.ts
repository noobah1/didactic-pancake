import { NextResponse } from 'next/server'
import { upsertSubscription } from '@/lib/push-store'
import { FavoriteRoute } from '@/lib/types'
import type { PushSubscription as WebPushSubscription } from 'web-push'

interface SubscribeBody {
  subscription: WebPushSubscription
  favorites: FavoriteRoute[]
}

export async function POST(request: Request) {
  const body: SubscribeBody = await request.json()

  if (!body.subscription?.endpoint || !body.subscription?.keys) {
    return NextResponse.json({ error: 'subscription is required' }, { status: 400 })
  }

  upsertSubscription(body.subscription, body.favorites || [])
  return NextResponse.json({ ok: true })
}
