import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/otp/:path*',
        destination: 'http://localhost:8080/otp/:path*',
      },
    ]
  },
}

export default nextConfig