import { matchVehicleToTrip, DelayStoptime } from '../delay'

// Simple 3-stop trip: origin -> mid -> terminus. Stops are placed a couple
// hundred meters apart along latitude so distance math is easy to reason
// about (1 degree latitude ~= 111320m).
const stoptimes: DelayStoptime[] = [
  {
    scheduledArrival: 1000,
    scheduledDeparture: 1000,
    stop: { name: 'Origin depot', lat: 59.4, lon: 24.7 },
  },
  {
    scheduledArrival: 1100,
    scheduledDeparture: 1120,
    stop: { name: 'Mid-route stop', lat: 59.41, lon: 24.71 },
  },
  {
    scheduledArrival: 1200,
    scheduledDeparture: 1200,
    stop: { name: 'Terminus depot', lat: 59.42, lon: 24.72 },
  },
]

describe('matchVehicleToTrip', () => {
  it('reports zero delay for a vehicle parked at the origin depot before departure', () => {
    const match = matchVehicleToTrip(stoptimes, 59.4, 24.7, 1300)
    expect(match.delaySeconds).toBe(0)
  })

  it('reports zero delay for a vehicle idling at the terminus depot long after its scheduled arrival', () => {
    // ~300m from the terminus stop — outside the old 150m "at stop" radius,
    // inside the wider terminus-only radius. Vehicle hasn't moved in a
    // while and the trip is well past its scheduled finish (1200 + 700s).
    const nearTerminusLat = 59.42 + 300 / 111320
    const match = matchVehicleToTrip(stoptimes, nearTerminusLat, 24.72, 1900)
    expect(match.delaySeconds).toBe(0)
  })

  it('still reports real lateness for a vehicle genuinely far from the terminus and overdue', () => {
    // ~500m out — beyond even the widened terminus radius — so this reads
    // as still approaching, not parked, and a real delay should surface.
    const farFromTerminusLat = 59.42 + 500 / 111320
    const match = matchVehicleToTrip(stoptimes, farFromTerminusLat, 24.72, 1900)
    expect(match.delaySeconds).toBeGreaterThan(0)
  })

  it('still reports real lateness for a vehicle mid-route, not at either terminus', () => {
    const match = matchVehicleToTrip(stoptimes, 59.41, 24.71, 1400)
    expect(match.delaySeconds).toBeGreaterThan(0)
  })

  it('interpolates delay from position along the current segment, not just the next stop\'s raw arrival', () => {
    // Vehicle is geometrically halfway between the mid-route stop (departs
    // 1120) and the terminus (arrives 1200) — a 80s leg, so halfway should
    // have happened at 1160. "Now" is 1200, the terminus's own scheduled
    // arrival — comparing that directly against the terminus's raw arrival
    // (the old behavior) reads as exactly on time, even though the vehicle
    // is still only halfway there and is actually 40s behind.
    const halfwayLat = 59.41 + (59.42 - 59.41) / 2
    const halfwayLon = 24.71 + (24.72 - 24.71) / 2
    const match = matchVehicleToTrip(stoptimes, halfwayLat, halfwayLon, 1200)
    expect(match.delaySeconds).toBeCloseTo(40, 0)
  })

  // Real depots are frequently modeled as two near-duplicate stops close
  // together — e.g. two GTFS stops both literally named "Mustamäe" a block
  // apart — one for boarding, one marking the yard. A vehicle parked
  // between them can end up physically closer to the second-to-last stop
  // than to the trip's actual final stop, so atStopIdx's "nearest wins"
  // search locks onto the wrong one. Confirmed live against production
  // data: this exact shape stayed stuck reporting growing delay even after
  // the terminus-radius widening above landed.
  const depotDuplicateStoptimes: DelayStoptime[] = [
    ...stoptimes.slice(0, 2),
    {
      scheduledArrival: 1180,
      scheduledDeparture: 1180,
      stop: { name: 'Terminus depot (near)', lat: 59.4197, lon: 24.7194 },
    },
    {
      scheduledArrival: 1200,
      scheduledDeparture: 1200,
      stop: { name: 'Terminus depot (actual)', lat: 59.42, lon: 24.72 },
    },
  ]

  it('reports zero delay when parked closer to a near-duplicate second-to-last stop than the true final stop', () => {
    // Sits right on top of the second-to-last stop (~48m from the actual
    // final stop) — closer to its neighbor, same as the real trolleybus
    // case, and well past the trip's scheduled finish. atStopIndex should
    // resolve to the *nearer* stop (proving the "wrong stop wins" scenario
    // is actually being exercised here), while delaySeconds still zeroes
    // out via the independent final-stop distance check.
    const match = matchVehicleToTrip(depotDuplicateStoptimes, 59.4197, 24.7194, 1900)
    expect(match.atStopIndex).toBe(depotDuplicateStoptimes.length - 2)
    expect(match.delaySeconds).toBe(0)
  })

  it('reports zero delay when parked closer to a near-duplicate second stop than the true origin', () => {
    // Mirror of the above at the start of the trip: stop 1 sits right next
    // to stop 0, and the vehicle is closer to stop 1. Still before the
    // trip's scheduled departure, so it hasn't actually pulled out yet.
    const originDuplicateStoptimes: DelayStoptime[] = [
      {
        scheduledArrival: 1000,
        scheduledDeparture: 1000,
        stop: { name: 'Origin depot (actual)', lat: 59.4, lon: 24.7 },
      },
      {
        scheduledArrival: 1020,
        scheduledDeparture: 1020,
        stop: { name: 'Origin depot (near)', lat: 59.4003, lon: 24.7003 },
      },
      ...stoptimes.slice(1),
    ]
    const match = matchVehicleToTrip(originDuplicateStoptimes, 59.4003, 24.7003, 900)
    expect(match.atStopIndex).not.toBe(0)
    expect(match.delaySeconds).toBe(0)
  })

  it('reports zero delay for a vehicle stuck near the origin long after the whole trip should have finished', () => {
    // The real bug this guards against: a bus ~150m from its trip's origin,
    // still sitting there ~30 minutes after its scheduled departure —
    // confirmed live (bus 59, "Balti jaam"). The time-predicted window
    // naturally assumes normal progression and lands near the trip's *end*
    // by this point (nowSec is even past the final stop's schedule), so an
    // earlier version of this check — gated on the window reaching back to
    // stop 0 — never even looked near the origin and kept reporting the gap
    // between nowSec and the trip's last stop as ever-growing delay.
    const nowFarPastEverything = stoptimes[stoptimes.length - 1].scheduledArrival + 600
    const match = matchVehicleToTrip(stoptimes, 59.4, 24.7, nowFarPastEverything)
    expect(match.delaySeconds).toBe(0)
  })

  it('accepts the rare false-positive tradeoff: a loop route coincidentally near its own origin mid-trip reads as zero delay too', () => {
    // Documents a known, accepted tradeoff rather than a hidden gap: this
    // network is point-to-point lines, not loops, so a mid-route stop
    // landing this close to the trip's own origin is not expected in
    // practice. An earlier version tried to guard against it (gated on the
    // search window reaching stop 0) but that gate broke the far more
    // common, repeatedly-confirmed depot case above — see the test right
    // above this one. If this ever becomes a real problem for an actual
    // route, revisit; until then, catching genuine depot layovers reliably
    // matters more than protecting a shape this network doesn't have.
    const loopStoptimes: DelayStoptime[] = Array.from({ length: 14 }, (_, i) => ({
      scheduledArrival: 1000 + i * 100,
      scheduledDeparture: 1000 + i * 100 + (i === 13 ? 0 : 20),
      stop: i === 6 ? { name: 'Loop-back near origin', lat: 59.4, lon: 24.7 } : { name: `Stop ${i}`, lat: 59.4 + i * 0.01, lon: 24.7 + i * 0.01 },
    }))
    const match = matchVehicleToTrip(loopStoptimes, 59.4, 24.7, 1750)
    expect(match.delaySeconds).toBe(0)
  })
})
