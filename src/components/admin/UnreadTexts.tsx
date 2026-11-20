'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { SmsConversation } from '@/lib/smsTypes';
import { readStaffPreference, useStaffProfile } from './StaffSession';

export default function UnreadTexts() {
  const profile = useStaffProfile();
  const [incoming, setIncoming] = useState<SmsConversation[]>([]);
  const [unread, setUnread] = useState<SmsConversation[]>([]);

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const response = await fetch('/api/admin/sms/inbox?incoming=1', { signal: controller.signal, cache: 'no-store' });
        if (response.ok) {
          const data: SmsConversation[] = await response.json();
          if (!controller.signal.aborted) setIncoming(data);
        }
      } catch { /* Try again on the next refresh. */ }
      finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [profile]);

  useEffect(() => {
    function updateUnread() {
      setUnread(profile ? incoming.filter(item => item.latest && item.latest.id !== readStaffPreference(profile, 'sms-read:' + item.phone)) : []);
    }
    updateUnread();
    window.addEventListener('storage', updateUnread);
    return () => window.removeEventListener('storage', updateUnread);
  }, [incoming, profile]);

  if (!unread.length) return null;
  return <section aria-labelledby="today-unread-texts" className="crm-panel p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2">
      <h2 id="today-unread-texts" className="text-lg font-semibold text-white">Unread texts</h2>
      <Link href="/admin/messages" className="inline-flex min-h-11 items-center text-sky-300">Messages</Link>
    </div>
    <ul className="divide-y divide-white/10">
      {unread.map(({ phone, jobs, latest }) => (
        <li key={phone}>
          <Link href={'/admin/messages?' + new URLSearchParams({ phone })}
            className="flex min-h-12 items-center gap-3 rounded px-1 py-2 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-sky-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{jobs[0]?.name || phone}</span>
              <span className="block truncate text-sm text-slate-300">{latest?.body || 'New text message'}</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-sky-300" />
          </Link>
        </li>
      ))}
    </ul>
  </section>;
}
