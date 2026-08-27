// Turns a RouteResult's already-attached leg fare facts (src/lib/plan-query.ts's
// attachLegFares, see LegFare in src/lib/types.ts) into money for one specific
// rider. Deliberately pure and client-safe: the GTFS index behind LegFare stays
// server-side (see src/lib/fares/gtfs-index.json, ~700KB), but re-pricing for a
// different rider profile needs no refetch — it's just this function against
// data already on the itinerary.
import { FareEvidence, FareTicket, ItineraryFare, RouteLeg, RouteResult } from '../types'
import { RiderProfile, TARIFFS, Tariff } from './tariffs'

// How much weaker each tier is than 'tariff' — see FareEvidence's own comment
// in types.ts for what each tier means. The itinerary as a whole is only ever
// as trustworthy as its weakest ticket.
const EVIDENCE_RANK: Record<FareEvidence, number> = { tariff: 0, floor: 1, operator: 2, unknown: 3 }

interface Group {
  authority: string | undefined
  firstBoardMs: number
  windowMs: number
  legs: RouteLeg[]
}

export function priceItinerary(route: RouteResult, profile: RiderProfile): ItineraryFare {
  const transitLegs = route.legs.filter((leg) => leg.mode !== 'walk')
  if (transitLegs.length === 0) {
    return { totalCents: 0, evidence: 'tariff', tickets: [] }
  }

  const groups: Group[] = []
  // Tracks each authority's currently-open group so a later leg can still
  // join it — not just the most recent group overall, since an unrelated
  // authority's leg in between (e.g. a walk, or a single Elron hop) must not
  // close a still-valid county transfer window.
  const openByAuthority = new Map<string, Group>()

  for (const leg of transitLegs) {
    const authority = leg.fare?.authority
    const boardMs = new Date(leg.startTime).getTime()

    // No fare fact at all (route never mapped to a known authority) — never
    // guess a transfer window for it, so it never combines with anything.
    if (!authority) {
      groups.push({ authority: undefined, firstBoardMs: boardMs, windowMs: 0, legs: [leg] })
      continue
    }

    const tariff = TARIFFS[authority]
    const windowMs = (tariff?.transferWindowSeconds ?? 0) * 1000
    const open = openByAuthority.get(authority)
    if (open && boardMs - open.firstBoardMs <= open.windowMs) {
      open.legs.push(leg)
      continue
    }

    const group: Group = { authority, firstBoardMs: boardMs, windowMs, legs: [leg] }
    groups.push(group)
    openByAuthority.set(authority, group)
  }

  const tickets: (FareTicket & { updatedOn?: string })[] = groups.map((group) => priceGroup(group, profile))

  let evidence: FareEvidence = 'tariff'
  for (const ticket of tickets) {
    if (EVIDENCE_RANK[ticket.evidence] > EVIDENCE_RANK[evidence]) evidence = ticket.evidence
  }

  const totalCents =
    evidence === 'operator' || evidence === 'unknown'
      ? undefined
      : tickets.reduce((sum, t) => sum + (t.cents ?? 0), 0)

  const pricesAsOf = tickets
    .map((t) => t.updatedOn)
    .filter((d): d is string => !!d)
    .sort()[0]

  return { totalCents, evidence, tickets: tickets.map(stripInternal), pricesAsOf }
}

// FareTicket as returned to callers has no `updatedOn` — it only exists
// internally to compute ItineraryFare.pricesAsOf without a second pass over
// the tariff table.
function stripInternal(ticket: FareTicket & { updatedOn?: string }): FareTicket {
  return { authority: ticket.authority, cents: ticket.cents, evidence: ticket.evidence, fareUrl: ticket.fareUrl }
}

function priceGroup(group: Group, profile: RiderProfile): FareTicket & { updatedOn?: string } {
  const legFareUrl = group.legs.map((l) => l.fare?.fareUrl).find((u): u is string => !!u)

  if (!group.authority) {
    return { authority: 'unknown', evidence: 'unknown', fareUrl: legFareUrl }
  }

  const tariff = TARIFFS[group.authority]
  if (!tariff) {
    return { authority: group.authority, evidence: 'unknown', fareUrl: legFareUrl }
  }

  const fareUrl = legFareUrl ?? tariff.fareUrl

  if (tariff.kind === 'commercial') {
    return { authority: group.authority, evidence: 'operator', fareUrl, updatedOn: tariff.updatedOn }
  }

  if (tariff.kind === 'demand') {
    const cents = tariff.floorPriceCents?.[profile.ageBand]
    return { authority: group.authority, cents, evidence: 'floor', fareUrl, updatedOn: tariff.updatedOn }
  }

  // kind: 'flat'
  const cents = resolveFlatCents(tariff, profile)
  return { authority: group.authority, cents, evidence: 'tariff', fareUrl, updatedOn: tariff.updatedOn }
}

function resolveFlatCents(tariff: Tariff, profile: RiderProfile): number | undefined {
  if (tariff.residentOf && profile.residentOf === tariff.residentOf && tariff.residentPriceCents) {
    return tariff.residentPriceCents[profile.ageBand]
  }
  return tariff.priceCents?.[profile.ageBand]
}
