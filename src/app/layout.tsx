import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration'
import { LanguageProvider } from '@/lib/i18n/context'
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

// Applies the device/browser's own light-or-dark preference before first
// paint — same query useTheme() (use-theme.ts) uses to stay in sync
// afterward, including live OS-level changes while the tab is open. Runs as
// a blocking inline script so there's no flash of the wrong theme while
// React hydrates; also sets the theme-color meta tag directly here rather
// than waiting for useTheme()'s effect to run post-hydration, so mobile
// browser chrome matches from the first frame too.
const themeInitScript = `(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');document.querySelector('meta[name="theme-color"]').setAttribute('content','#15202B');}}catch(e){}})()`

// Sets <html lang> before first paint, same "read the DOM immediately on the
// client instead of a post-hydration correction" pattern as themeInitScript
// above — see LanguageProvider's initialLocale for the client-side read this
// pairs with. A remembered choice (localStorage) wins outright; otherwise
// the browser's own language list picks among the three supported locales,
// falling back to Estonian (this app's home market) rather than English.
const langInitScript = `(function(){try{var s=localStorage.getItem('lt-lang');var l=(s==='en'||s==='et'||s==='ru')?s:null;if(!l){var langs=navigator.languages||[navigator.language||''];for(var i=0;i<langs.length;i++){var p=(langs[i]||'').slice(0,2).toLowerCase();if(p==='ru'||p==='en'||p==='et'){l=p;break;}}}document.documentElement.lang=l||'et';}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="et" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: langInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ServiceWorkerRegistration />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  )
}
