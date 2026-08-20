'use client';

// Guest logins moved into Settings (see src/app/admin/settings/page.tsx,
// "Guest logins" section) — this stub keeps old links/bookmarks working.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GuestsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/settings'); }, [router]);
  return null;
}
