'use client';

// Quotes moved onto the Invoices page as a second tab — see
// /admin/invoices/page.tsx. This stub keeps old links/bookmarks (and the
// booking detail page's `from=` back-link) working.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function QuotesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/invoices?tab=quotes'); }, [router]);
  return null;
}
