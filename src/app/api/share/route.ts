import { NextResponse } from 'next/server'
import { createShare, getShare, updateSharePosition, clearSharePosition } from '@/lib/share-store'
import { RouteResult } from '@/lib/types'

export async function POST(request: Request) {
  const body: { route?: RouteResult } = await request.json()
  if (!body.route?.legs?.length) {
    return NextResponse.json({ error: 'route is required' }, { status: 400 })
  }
  const { id, token } = createShare(body.route)
  return NextResponse.json({ id, token })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const share = getShare(id)
  if (!share) {
    return NextResponse.json({ error: 'Shared journey not found or expired' }, { status: 404 })
  }
  return NextResponse.json(share)
}

// Broadcasts the sharer's own current position onto an already-created
// share — see use-live-share.ts. Requires the owner token handed back from
// POST above, so only whoever created the link (not everyone holding it)
// can write to it.
export async function PATCH(request: Request) {
  const body: { id?: string; token?: string; lat?: number; lng?: number } = await request.json()
  if (!body.id || !body.token || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return NextResponse.json({ error: 'id, token, lat and lng are required' }, { status: 400 })
  }
  const ok = updateSharePosition(body.id, body.token, body.lat, body.lng)
  if (!ok) {
    return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

// Stops sharing live location without invalidating the journey link itself
// — the route snapshot stays shareable, only the position is removed.
export async function DELETE(request: Request) {
  const body: { id?: string; token?: string } = await request.json()
  if (!body.id || !body.token) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }
  const ok = clearSharePosition(body.id, body.token)
  if (!ok) {
    return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
