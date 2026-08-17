import { NextResponse } from 'next/server'
import { createShare, getShare } from '@/lib/share-store'
import { RouteResult } from '@/lib/types'

export async function POST(request: Request) {
  const body: { route?: RouteResult } = await request.json()
  if (!body.route?.legs?.length) {
    return NextResponse.json({ error: 'route is required' }, { status: 400 })
  }
  const id = createShare(body.route)
  return NextResponse.json({ id })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const route = getShare(id)
  if (!route) {
    return NextResponse.json({ error: 'Shared journey not found or expired' }, { status: 404 })
  }
  return NextResponse.json({ route })
}
