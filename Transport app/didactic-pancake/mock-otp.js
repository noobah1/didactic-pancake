// Mock OTP server for testing - responds on port 8080
const http = require('http')

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.url === '/otp/gtfs/v1' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const query = JSON.parse(body)
        console.log('📍 OTP Request:', query)

        // Parse from/to coordinates
        const from = query.variables?.from
        const to = query.variables?.to

        if (!from || !to) {
          res.writeHead(400)
          res.end(JSON.stringify({ errors: [{ message: 'Missing from/to' }] }))
          return
        }

        // Generate mock response
        const now = Date.now()
        const startTime = now + 60000 // 1 minute from now
        const endTime = startTime + 1800000 // 30 minutes duration

        const response = {
          data: {
            plan: {
              itineraries: [
                {
                  duration: 1800000,
                  startTime,
                  endTime,
                  walkDistance: 250,
                  legs: [
                    {
                      mode: 'WALK',
                      start: { scheduledTime: startTime },
                      end: { scheduledTime: startTime + 120000 },
                      from: {
                        name: 'Start walk',
                        lat: from.lat,
                        lon: from.lon,
                      },
                      to: {
                        name: 'Bus stop A',
                        lat: from.lat + 0.002,
                        lon: from.lon + 0.002,
                      },
                      duration: 120000,
                      legGeometry: { points: '_' },
                    },
                    {
                      mode: 'BUS',
                      start: { scheduledTime: startTime + 120000 },
                      end: { scheduledTime: startTime + 1020000 },
                      from: {
                        name: 'Bus stop A',
                        lat: from.lat + 0.002,
                        lon: from.lon + 0.002,
                        stop: { gtfsId: 'mock:1' },
                      },
                      to: {
                        name: 'Bus stop B',
                        lat: to.lat - 0.002,
                        lon: to.lon - 0.002,
                        stop: { gtfsId: 'mock:2' },
                      },
                      duration: 900000,
                      route: { shortName: '2' },
                      trip: { gtfsId: 'mock:trip:1' },
                      legGeometry: { points: '_' },
                      realTime: false,
                    },
                    {
                      mode: 'WALK',
                      start: { scheduledTime: startTime + 1020000 },
                      end: { scheduledTime: endTime },
                      from: {
                        name: 'Bus stop B',
                        lat: to.lat - 0.002,
                        lon: to.lon - 0.002,
                      },
                      to: {
                        name: 'Destination',
                        lat: to.lat,
                        lon: to.lon,
                      },
                      duration: 780000,
                      legGeometry: { points: '_' },
                    },
                  ],
                },
                {
                  duration: 2400000,
                  startTime: startTime + 600000,
                  endTime: startTime + 600000 + 2400000,
                  walkDistance: 180,
                  legs: [
                    {
                      mode: 'WALK',
                      start: { scheduledTime: startTime + 600000 },
                      end: { scheduledTime: startTime + 720000 },
                      from: {
                        name: 'Start walk',
                        lat: from.lat,
                        lon: from.lon,
                      },
                      to: {
                        name: 'Tram stop C',
                        lat: from.lat - 0.001,
                        lon: from.lon + 0.001,
                      },
                      duration: 120000,
                      legGeometry: { points: '_' },
                    },
                    {
                      mode: 'TRAM',
                      start: { scheduledTime: startTime + 720000 },
                      end: { scheduledTime: startTime + 2520000 },
                      from: {
                        name: 'Tram stop C',
                        lat: from.lat - 0.001,
                        lon: from.lon + 0.001,
                        stop: { gtfsId: 'mock:3' },
                      },
                      to: {
                        name: 'Tram stop D',
                        lat: to.lat + 0.001,
                        lon: to.lon - 0.001,
                        stop: { gtfsId: 'mock:4' },
                      },
                      duration: 1800000,
                      route: { shortName: '4' },
                      trip: { gtfsId: 'mock:trip:2' },
                      legGeometry: { points: '_' },
                      realTime: false,
                    },
                    {
                      mode: 'WALK',
                      start: { scheduledTime: startTime + 2520000 },
                      end: { scheduledTime: startTime + 2640000 },
                      from: {
                        name: 'Tram stop D',
                        lat: to.lat + 0.001,
                        lon: to.lon - 0.001,
                      },
                      to: {
                        name: 'Destination',
                        lat: to.lat,
                        lon: to.lon,
                      },
                      duration: 120000,
                      legGeometry: { points: '_' },
                    },
                  ],
                },
              ],
            },
          },
        }

        res.writeHead(200)
        res.end(JSON.stringify(response))
      } catch (error) {
        console.error('Error:', error)
        res.writeHead(500)
        res.end(JSON.stringify({ errors: [{ message: 'Server error' }] }))
      }
    })
  } else if (req.url === '/otp/gtfs/v1/alerts' && req.method === 'POST') {
    // Mock alerts response
    res.writeHead(200)
    res.end(JSON.stringify({ data: { alerts: [] } }))
  } else {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  }
})

server.listen(8080, () => {
  console.log('🚀 Mock OTP server running on http://localhost:8080')
  console.log('📍 Ready to handle route planning requests!')
})
