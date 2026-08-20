// A rider reading a live marker needs to know how stale it might be — the
// web has no reliable background location, so "3 min ago" vs "just now" is
// often the difference between trusting the dot and not.
export function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)}h ago`
}
