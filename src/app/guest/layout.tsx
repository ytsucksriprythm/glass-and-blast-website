import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Glass & Blast Jobs',
  manifest: '/admin.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'G&B Jobs',
    statusBarStyle: 'black-translucent',
  },
  icons: { apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#060D1A',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  // Reuses the `admin-shell` marker so globals.css paints the page (and the iOS
  // status-bar area) dark navy, matching the admin app.
  return <div className="admin-shell bg-navy-900 text-slate-100 min-h-[100svh]">{children}</div>;
}
