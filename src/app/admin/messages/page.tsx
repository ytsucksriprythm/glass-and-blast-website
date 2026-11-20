'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, ChevronRight, MessageSquare, Search } from 'lucide-react';
import { AdminMobileNav, AdminMoreSheet, AdminSidebar, adminNavItems, useMoreSheet } from '@/components/admin/AdminNav';
import SmsPanel from '@/components/admin/SmsPanel';
import { useStaffProfile } from '@/components/admin/StaffSession';
import { smsPhone, type SmsConversation } from '@/lib/smsTypes';

const nav = adminNavItems();
const messagesPath = '/admin/messages';
const shortDate = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' });
const jobDate = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });

function Messages() {
  const router = useRouter();
  const profile = useStaffProfile();
  const more = useMoreSheet();
  const query = useSearchParams();
  const phone = smsPhone(query.get('phone') ?? '');
  const [inbox, setInbox] = useState<SmsConversation[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const response = await fetch('/api/admin/sms/inbox', { cache: 'no-store', signal: controller.signal });
        if (response.status === 403) {
          if (profile) setError('Your session expired. Sign in again to view messages.');
          else router.replace('/admin');
          return;
        }
        if (!response.ok) throw new Error('Could not load conversations.');
        const data: SmsConversation[] = await response.json();
        if (!controller.signal.aborted) {
          setInbox(data);
          setError('');
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load conversations.');
      } finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [profile, router]);

  const conversation = inbox?.find(item => item.phone === phone);
  const jobs = conversation?.jobs ?? [];
  const term = search.trim().toLowerCase();
  const visible = inbox?.filter(item => term
    ? item.phone.includes(term) || smsPhone(term) === item.phone ||
      item.jobs.some(job => [job.name, job.address, job.id].some(value => value.toLowerCase().includes(term))) ||
      item.latest?.body.toLowerCase().includes(term)
    : Boolean(item.latest));
  const href = phone ? messagesPath + '?' + new URLSearchParams({ phone }) : messagesPath;

  return (
    <div className="flex min-h-[100svh] bg-navy-900">
      <AdminSidebar active="messages" items={nav} />
      <main className="mx-auto flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] w-full min-w-0 max-w-7xl flex-col p-3 lg:h-[100dvh] lg:p-6"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-navy-800">
          <section aria-label="Inbox" className={(phone ? 'hidden md:flex ' : 'flex ') + 'w-full min-w-0 flex-col md:w-80 md:shrink-0 md:border-r md:border-white/10'}>
            <header className="border-b border-white/10 p-4">
              <h1 className="text-2xl font-bold text-white">Messages</h1>
              <div className="relative mt-3">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
                <input type="search" aria-label="Search conversations" placeholder="Name, number or address" className="form-input min-h-11 pl-9 text-base"
                  value={search} onChange={event => setSearch(event.target.value)} />
              </div>
            </header>
            {error && <p role="alert" className="p-4 text-sm text-red-300">{error}</p>}
            {!inbox && !error && <p role="status" className="p-4 text-sm text-slate-300">Loading conversations…</p>}
            {visible && !visible.length && <p className="p-4 text-sm text-slate-300">{term ? 'No conversations match your search.' : 'No messages yet. Search for a customer to start a conversation.'}</p>}
            <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto overscroll-contain">
              {visible?.map(item => (
                <li key={item.phone}>
                  <Link href={messagesPath + '?' + new URLSearchParams({ phone: item.phone })} aria-current={phone === item.phone ? 'page' : undefined}
                    className={'flex min-h-16 items-center gap-3 px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-300 ' +
                      (phone === item.phone ? 'bg-sky-400/15' : 'hover:bg-white/5')}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy-600 text-sm font-semibold text-sky-200" aria-hidden="true">
                      {item.jobs[0]?.name.trim()?.[0]?.toUpperCase() || <MessageSquare className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold text-white">{item.jobs[0]?.name || item.phone}</span>
                        {item.latest && <time className="shrink-0 text-xs text-slate-300" dateTime={item.latest.createdAt}>{shortDate.format(new Date(item.latest.createdAt))}</time>}
                      </div>
                      <p className="truncate text-sm text-slate-300">{item.latest ? (item.latest.direction === 'outbound' ? 'You: ' : '') + item.latest.body : item.phone}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {phone ? <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
            <header className="border-b border-white/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <Link href={messagesPath} aria-label="Back to messages" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-sky-300 md:hidden"><ArrowLeft className="size-5" /></Link>
                <div className="min-w-0 py-1">
                  <h2 className="truncate font-semibold text-white">{jobs[0]?.name || phone}</h2>
                  {jobs[0]?.name && <p className="text-xs text-slate-300">{phone}</p>}
                </div>
              </div>
              <details key={phone} className="rounded-lg bg-navy-900/60 px-3">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-sky-300">
                  <CalendarClock aria-hidden="true" className="size-4" /> Linked jobs{inbox ? ' (' + jobs.length + ')' : ''}
                  <ChevronRight aria-hidden="true" className="ml-auto size-4" />
                </summary>
                {!inbox && <p className="pb-3 text-sm text-slate-300">{error || 'Loading linked jobs…'}</p>}
                {inbox && !jobs.length && <p className="pb-3 text-sm text-slate-300">No bookings use this number.</p>}
                <ul className="max-h-40 divide-y divide-white/10 overflow-y-auto overscroll-contain">
                  {jobs.map(job => (
                    <li key={job.id}>
                      <Link href={'/admin/bookings/' + encodeURIComponent(job.id) + '?from=' + encodeURIComponent(href)}
                        className="flex min-h-11 flex-col justify-center py-2 text-sm hover:text-sky-300">
                        <span className="break-words font-medium">{job.address || job.name || job.id}</span>
                        <span className="text-xs capitalize text-slate-300">{job.status.replaceAll('-', ' ')}{job.scheduledAt ? ' · ' + jobDate.format(new Date(job.scheduledAt)) : ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </header>
            {profile ? <SmsPanel key={phone} kind="manual" recordId={'phone:' + phone} conversation={{ href, jobIds: jobs.map(job => job.id) }} />
              : <p className="p-4 text-sm text-slate-300">Loading conversation…</p>}
          </section> : <div className="hidden flex-1 flex-col items-center justify-center gap-2 p-4 text-slate-300 md:flex">
            <MessageSquare aria-hidden="true" className="size-7 text-sky-300" />
            <p>Select a conversation</p>
          </div>}
        </div>
      </main>
      <AdminMobileNav active="messages" items={nav} onMore={more.show} />
      <AdminMoreSheet active="messages" items={nav} open={more.open} onClose={more.hide} />
    </div>
  );
}

export default function MessagesPage() {
  return <Suspense fallback={<p className="p-4 text-slate-300">Loading messages…</p>}><Messages /></Suspense>;
}
