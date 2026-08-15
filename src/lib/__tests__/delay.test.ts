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
})
