import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'LiveTravel',
  description: 'Public transport route planner for Estonia',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LiveTravel',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1D4ED8',
  width: 'device-width',
  initialScale: 1,
}

// Applies the saved theme before first paint — light unless the user
// explicitly switched to dark last time. Deliberately ignores the device's
// own color-scheme setting: a phone's own night-schedule dark mode used to
// carry straight through to this app unannounced, which read as broken
// rather than intentional. Runs as a blocking inline script so there's no
// flash of the wrong theme while React hydrates — useTheme() (use-theme.ts)
// picks up from whatever class this already applied and keeps it live
// afterward on manual toggles.
const themeInitScript = `(function(){try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="et" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  )
}
