// Minutes as "45 min" below an hour, "1h" or "1h 5min" at or above — never a
// bare "65 min" a rider has to do the hour arithmetic on themselves.
export function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`
}
