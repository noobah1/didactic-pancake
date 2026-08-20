'use client'

import { useEffect, useState } from 'react'
import { Check, MapPin, Share2, X } from 'lucide-react'
import { RouteResult, RouteTrafficEstimate } from '@/lib/types'
import { DelayedVehicle } from '@/app/api/delays/route'
import { RouteCard } from './RouteCard'
import { useLiveShare } from '@/hooks/use-live-share'

type SortMode = 'duration' | 'departure'
type ShareState = 'idle' | 'sharing' | 'error'

// Purely decorative affordance marking this as a sheet anchored to the
// bottom edge on mobile — hidden from sm: up, where the panel floats as a
// regular card instead and a drag handle would be a lie (nothing to drag).
function SheetHandle() {
  return (
    <div className="flex justify-center pt-2 pb-1 sm:hidden">
      <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
    </div>
  )
}

interface RouteResultsProps {
  routes: RouteResult[]
  loading: boolean
  error: string | null
  notice?: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  delayVehicles?: DelayedVehicle[]
  trafficEstimates?: RouteTrafficEstimate[]
}

export function RouteResults({ routes, loading, error, notice, selectedId, onSelect, delayVehicles, trafficEstimates }: RouteResultsProps) {
  const [sortBy, setSortBy] = useState<SortMode>('duration')
  const [shareState, setShareState] = useState<ShareState>('idle')
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState<string | null>(null)
  // The route this share/token pair belongs to — used only to auto-stop live
  // sharing if the user navigates away from this journey (back to the route
  // list, or a different route entirely) without explicitly turning it off.
  const [sharedRouteId, setSharedRouteId] = useState<string | null>(null)
  const liveShare = useLiveShare(shareId, shareToken)

  useEffect(() => {
    if (sharedRouteId && selectedId !== sharedRouteId && liveShare.sharing) {
      liveShare.stop()
    }
    // liveShare's identity changes every render (new callbacks) — only
    // re-run this when the route selection itself actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, sharedRouteId])

  const copyLink = (link: string) => {
    // Fire-and-forget: clipboard permission can hang or be denied outright
    // (embedded/PWA webviews, browsers with no clipboard-write grant), and
    // the link is already shown as selectable text either way — so a stuck
    // or rejected promise here must never block the button's own state.
    navigator.clipboard?.writeText(link).then(
      () => {
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2000)
      },
      () => {},
    )
  }

  const handleShare = async (route: RouteResult) => {
    // A fresh link needs its own opt-in — carrying live sharing over from a
    // previous link would broadcast to whoever holds the new one under the
    // old one's token, silently.
    if (liveShare.sharing) liveShare.stop()
    setShareId(null)
    setShareToken(null)
    setSharedRouteId(null)
    setShareState('sharing')
    setShareLink(null)
    setLinkCopied(false)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route }),
      })
      if (!res.ok) throw new Error('share failed')
      const { id, token } = await res.json()
      setShareId(id)
      setShareToken(token)
      setSharedRouteId(route.id)
      const link = `${window.location.origin}${window.location.pathname}?share=${id}`

      // On phones/PWAs, handing off straight to the OS share sheet (Messages,
      // WhatsApp, email, ...) beats making someone copy-paste a link.
      if (navigator.share) {
        try {
          await navigator.share({ title: 'My journey', url: link })
          setShareState('idle')
          return
        } catch (shareErr) {
          if ((shareErr as Error)?.name === 'AbortError') {
            setShareState('idle') // user dismissed the share sheet — not a failure
            return
          }
          // Share sheet unavailable/failed for some other reason — fall
          // through to showing the link directly below.
        }
      }

      setShareState('idle')
      setShareLink(link)
      copyLink(link)
    } catch {
      setShareState('error')
      setTimeout(() => setShareState('idle'), 2000)
    }
  }

  if (loading) {
    return (
      <div className="rounded-t-2xl sm:rounded-xl shadow-lg bg-white dark:bg-gray-800">
        <SheetHandle />
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Searching routes...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-t-2xl sm:rounded-xl shadow-lg bg-white dark:bg-gray-800">
        <SheetHandle />
        <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  if (routes.length === 0) return null

  const sorted = [...routes].sort((a, b) =>
    sortBy === 'duration'
      ? a.duration - b.duration
      : new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )
  // Once a journey is picked, show just that one instead of the whole list
  // buried underneath it.
  const visible = selectedId ? sorted.filter((route) => route.id === selectedId) : sorted

  return (
    <div className={`flex flex-col bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-lg ${selectedId ? 'max-h-[50vh] sm:max-h-[24rem]' : 'max-h-[40vh] sm:max-h-80'}`}>
      <SheetHandle />
      <div className="flex items-center justify-between px-3 pt-1 pb-1">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{selectedId ? 'Your journey' : 'Routes'}</h2>
        {selectedId && (
          <button
            type="button"
            onClick={() => {
              const route = routes.find((r) => r.id === selectedId)
              if (route) handleShare(route)
            }}
            disabled={shareState === 'sharing'}
            title="Get a link to this journey"
            aria-label="Get a link to this journey"
            className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-full ${shareState === 'error' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          >
            {shareState === 'error' ? (
              'Failed'
            ) : (
              <>
                <Share2 size={13} /> {shareState === 'sharing' ? 'Sharing…' : 'Share'}
              </>
            )}
          </button>
        )}
        {!selectedId && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSortBy('duration')}
              className={`px-2 py-1.5 text-xs rounded-full ${sortBy === 'duration' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              Fastest
            </button>
            <button
              type="button"
              onClick={() => setSortBy('departure')}
              className={`px-2 py-1.5 text-xs rounded-full ${sortBy === 'departure' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              Departure
            </button>
          </div>
        )}
      </div>
      {shareLink && (
        <div className="mx-3 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs">
          <span className="flex-1 min-w-0 truncate select-all">{shareLink}</span>
          <button
            type="button"
            onClick={() => copyLink(shareLink)}
            className="shrink-0 flex items-center gap-1 font-medium hover:underline"
          >
            {linkCopied ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              'Copy'
            )}
          </button>
          <button
            type="button"
            onClick={() => setShareLink(null)}
            aria-label="Dismiss share link"
            className="shrink-0 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {shareId && shareToken && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-900 text-xs">
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <MapPin size={12} className={liveShare.sharing ? 'text-blue-600 dark:text-blue-400' : ''} />
            {liveShare.sharing ? 'Sharing your live location' : 'Share your live location on this link'}
          </span>
          <button
            type="button"
            onClick={() => (liveShare.sharing ? liveShare.stop() : liveShare.start())}
            className={`shrink-0 px-2 py-0.5 rounded-full font-medium ${
              liveShare.sharing
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            }`}
          >
            {liveShare.sharing ? 'On' : 'Off'}
          </button>
        </div>
      )}
      {liveShare.sharing && (
        <div className="mx-3 mb-2 px-2.5 py-1 text-[11px] text-gray-400 dark:text-gray-500">
          Your screen will stay on while sharing so your location keeps updating.
        </div>
      )}
      {liveShare.error && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-300 text-xs">
          {liveShare.error}
        </div>
      )}
      {notice && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-xs">
          {notice}
        </div>
      )}
      <div className="flex flex-col gap-2 px-3 pb-3 overflow-y-auto">
      {visible.map((route) => (
        <RouteCard
          key={route.id}
          route={route}
          selected={route.id === selectedId}
          onSelect={() => onSelect(route.id === selectedId ? null : route.id)}
          delayVehicles={delayVehicles}
          trafficEstimates={trafficEstimates}
        />
      ))}
      </div>
    </div>
  )
}
