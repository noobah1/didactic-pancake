// Targeted OTP GraphQL fetch for exactly the given route id(s), aliased so
// one request covers many routes at once — a shortName+mode can map to more
// than one Route entity in the feed (e.g. a peak-hour variant with its own
// gtfsId), so this can't just be route(id:) for a single id. Extracted from
// src/app/api/trip-stops/route.ts (its Tallinn-route fast path) so
// src/lib/traffic/estimate.ts can reuse the exact same batched-alias shape
// for the 251 intercity/regional routes in ROUTE_COVERAGE, rather than
// duplicating it with a subtly different query.
export function buildRoutesByIdQuery(ids: string[], options: { includeGeometry?: boolean } = {}): string {
  // trip-stops/route.ts needs patternGeometry (drawing the route line on the
  // map); estimate.ts only needs stop-to-stop schedule timing, and the 251
  // routes it queries at once would otherwise pull a nationwide-scale amount
  // of unused polyline points into a request that's already cached for 6h.
  const includeGeometry = options.includeGeometry ?? true
  const fields = ids
    .map(
      (id, i) =>
        `r${i}: route(id: ${JSON.stringify(id)}) { patterns { ${
          includeGeometry ? 'patternGeometry { points } ' : ''
        }tripsForDate(serviceDate: $date) { gtfsId stoptimes { scheduledArrival scheduledDeparture stop { name lat lon gtfsId } } } } }`,
    )
    .join('\n')
  return `query($date: String!) { ${fields} }`
}
