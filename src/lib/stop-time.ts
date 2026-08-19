export function minutesUntil(epochSec: number): number {
  return Math.round((epochSec * 1000 - Date.now()) / 60_000)
}

export function formatClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
