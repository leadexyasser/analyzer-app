import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: { default: 'Call Analyzer', template: '%s — Call Analyzer' },
  description: 'Final expense call analysis powered by AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
        {children}
        <Toaster theme="dark" />
      </body>
    </html>
  )
}
