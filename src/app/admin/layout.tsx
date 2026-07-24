import type { Metadata, Viewport } from 'next';
import InstallPromptGuard from '@/components/admin/InstallPromptGuard';

// Scopes the installable PWA (and app-like meta) to the /admin section only,
// so the public marketing site is unaffected.
export const metadata: Metadata = {
  title: 'Glass & Blast Admin',
  manifest: '/admin.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'G&B Admin',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#060D1A',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // The admin stays on the dark theme even though the public site is now light.
  // `admin-shell` lets globals.css paint the page background (incl. the iOS
  // status-bar / overscroll area) dark instead of the site's white body.
  return (
    <div className="admin-shell bg-navy-900 text-slate-100 min-h-[100svh]">
      <InstallPromptGuard />
      {children}
    </div>
  );
}
