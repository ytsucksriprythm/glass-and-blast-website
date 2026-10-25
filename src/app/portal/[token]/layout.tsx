import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your account - Glass & Blast',
  robots: { index: false, follow: false }, // private customer link
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
