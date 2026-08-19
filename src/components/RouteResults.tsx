'use client'

import { useState } from 'react'
import { Check, Share2, X } from 'lucide-react'
import { RouteResult, RouteTrafficEstimate } from '@/lib/types'
import { DelayedVehicle } from '@/app/api/delays/route'
import { RouteCard } from './RouteCard'

type SortMode = 'duration' | 'departure'
type ShareState = 'idle' | 'sharing' | 'error'

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
      const { id } = await res.json()
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
    return <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm bg-white dark:bg-gray-800 rounded-xl shadow-lg mt-2">Searching routes...</div>
  }

  if (error) {
    return <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm bg-white dark:bg-gray-800 rounded-xl shadow-lg mt-2">{error}</div>
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
    <div className={`flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-lg mt-2 ${selectedId ? 'max-h-[40vh] sm:max-h-[24rem]' : 'max-h-44 sm:max-h-80'}`}>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
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
            className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-full transition-colors ${shareState === 'error' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
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
              className={`px-2 py-1.5 text-xs rounded-full transition-colors ${sortBy === 'duration' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              Fastest
            </button>
            <button
              type="button"
              onClick={() => setSortBy('departure')}
              className={`px-2 py-1.5 text-xs rounded-full transition-colors ${sortBy === 'departure' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
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
