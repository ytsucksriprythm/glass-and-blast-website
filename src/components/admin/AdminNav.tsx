'use client';

import { isStaffProfile, STAFF_PROFILES } from '@/lib/staff';
import { readStaffPreference, useStaffProfile } from './StaffSession';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Calendar as CalendarIcon, CalendarClock, FileText, Repeat,
  BarChart3, Settings as SettingsIcon, LogOut, Menu, X, PhoneCall, MessageSquare, ChevronDown,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/version';

// Single source of truth for admin nav order: Overview, Bookings, Calendar,
// Invoices & Quotes, Recurring Plans, Stats, Settings. Quotes live as a tab on
// the Invoices page (src/app/admin/invoices/page.tsx); Business/Site stats
// live as two tabs on the Stats view (dashboard 'business'/'site' tabs);
// Guest Logins moved into Settings — none of those get their own nav entry.
export type AdminNavKey = 'overview' | 'bookings' | 'calendar' | 'invoices' | 'recurring' | 'calling' | 'stats' | 'settings' | 'messages';

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;        // navigate here
  onClick?: () => void; // or run this instead (in-page tab switch, no navigation)
  badge?: number;
  warn?: string;        // shows a small "!" marker next to the tab — hover/tap for this text.
                         // Use for "not ready yet" style cautions, not numeric counts (see badge).
};

// Build the 8 nav items in the fixed order above. Pass `onTab` when rendered
// from inside the dashboard page itself, so Overview/Bookings/Business/Site
// switch tabs locally instead of doing a full navigation; omit it (as on the
// calendar/invoices/recurring/guests pages) to navigate to the dashboard tab via URL.
export function adminNavItems(opts: {
  onTab?: (tab: 'overview' | 'bookings' | 'business' | 'site') => void;
  pending?: number;
} = {}): AdminNavItem[] {
  const { onTab, pending = 0 } = opts;
  const tabHref = (t: string) => `/admin/dashboard?tab=${t}`;
  const tabItem = (t: 'overview' | 'bookings' | 'business' | 'site') =>
    onTab ? { onClick: () => onTab(t) } : { href: tabHref(t) };

  return [
    { key: 'overview', label: 'Today', icon: LayoutDashboard, ...tabItem('overview') },
    { key: 'bookings', label: 'Bookings', icon: CalendarIcon, badge: pending, ...tabItem('bookings') },
    { key: 'calendar', label: 'Calendar', icon: CalendarClock, href: '/admin/calendar' },
    { key: 'messages', label: 'Messages', icon: MessageSquare, href: '/admin/messages' },
    { key: 'calling', label: 'Call List', icon: PhoneCall, href: '/admin/call-list' },
    { key: 'invoices', label: 'Invoices & Quotes', icon: FileText, href: '/admin/invoices' },
    { key: 'recurring', label: 'Recurring Plans', icon: Repeat, href: '/admin/recurring' },
    // "Stats" opens on the Business tab; Site Stats is the second tab there.
    { key: 'stats', label: 'Stats', icon: BarChart3, ...tabItem('business') },
    { key: 'settings', label: 'Settings', icon: SettingsIcon, href: '/admin/settings' },
  ];
}

function useLogout() {
  const router = useRouter();
  return async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin');
  };
}

function StaffProfileSelect() {
  const profile = useStaffProfile();
  const [switching, setSwitching] = useState(false);
  if (!profile) return null;

  async function switchTo(next: string) {
    if (switching || next === profile || !isStaffProfile(next)) return;
    setSwitching(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: next, switchProfile: true }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to switch profiles.' : 'Could not switch profiles.');
      window.location.assign('/admin/dashboard');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch profiles.');
      setSwitching(false);
    }
  }

  return <div className="relative inline-block">
    <select aria-label="Switch staff profile" value={profile} disabled={switching} onChange={event => void switchTo(event.target.value)}
      className="min-h-11 cursor-pointer appearance-none border-0 bg-transparent py-0 pl-0 pr-4 text-xs text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-50 lg:min-h-5">
      {Object.entries(STAFF_PROFILES).map(([key, name]) => <option className="bg-navy-800 text-white" key={key} value={key}>{name}</option>)}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 size-3 -translate-y-1/2 text-sky-300" />
  </div>;
}

function useResumeBooking() {
  const profile = useStaffProfile();
  const router = useRouter();
  return (item: AdminNavItem) => {
    if (item.key !== 'bookings') return false;
    const href = readStaffPreference(profile, 'open-booking');
    if (!href || !/^\/admin\/bookings\/[A-Za-z0-9_-]+(?:\?|$)/.test(href)) return false;
    if (location.pathname + location.search !== href) router.push(href);
    return true;
  };
}

function NavLink({ item, active, className }: { item: AdminNavItem; active: boolean; className: string }) {
  const resumeBooking = useResumeBooking();
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="w-4 h-4" /> {item.label}
      {!!item.badge && (
        <span className="ml-auto w-5 h-5 bg-amber-400/20 text-amber-400 text-xs rounded-full flex items-center justify-center font-bold">
          {item.badge}
        </span>
      )}
      {!item.badge && item.warn && (
        <span title={item.warn} className="ml-auto w-5 h-5 bg-amber-400 text-navy-900 text-xs rounded-full flex items-center justify-center font-extrabold">
          !
        </span>
      )}
    </>
  );
  const cls = `${className} ${active ? 'active' : ''}`;
  return item.onClick
    ? <button onClick={() => { if (!resumeBooking(item)) item.onClick?.(); }} className={cls} title={item.warn}>{content}</button>
    : <Link href={item.href!} onClick={event => { if (resumeBooking(item)) event.preventDefault(); }} className={cls} title={item.warn}>{content}</Link>;
}

// ─── Desktop sidebar — persistent on lg+, never goes fullscreen ────────────
export function AdminSidebar({ active, items }: { active: AdminNavKey; items: AdminNavItem[] }) {
  const logout = useLogout();
  const profile = useStaffProfile();
  return (
    <aside className="crm-sidebar w-64 flex-shrink-0 hidden lg:flex flex-col bg-navy-800 border-r border-white/5 p-6">
      <div className="mb-5 flex items-center gap-3 border-b border-white/10 pb-5">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-navy-900">
          <Image src="/logo.png" alt="" width={837} height={748} sizes="96px"
            className="absolute inset-0 size-full scale-150 object-contain" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Glass &amp; Blast</p>
          {profile ? <StaffProfileSelect /> : <p className="text-xs text-slate-300">Admin panel</p>}
        </div>
      </div>
      <nav aria-label="CRM navigation" className="flex-1 space-y-4">
        {[
          { label: 'Daily work', keys: ['overview', 'bookings', 'calendar', 'calling', 'messages'] },
          { label: 'Business', keys: ['invoices', 'recurring', 'stats', 'settings'] },
        ].map(group => (
          <div key={group.label} className="space-y-1">
            <p className="crm-nav-label">{group.label}</p>
            {items.filter(item => group.keys.includes(item.key)).map(item => (
              <NavLink key={item.key} item={item} active={active === item.key} className="admin-sidebar-link w-full text-left" />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/5 pt-4 space-y-2">
        <div className="text-slate-600 text-[10px] text-center">v{APP_VERSION}</div>
        <a href="/" target="_blank" className="admin-sidebar-link block text-xs">← View website</a>
        <button onClick={logout} className="admin-sidebar-link w-full text-red-400 hover:text-red-300 hover:bg-red-400/5">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </aside>
  );
}

const MOBILE_PRIMARY: AdminNavKey[] = ['overview', 'bookings', 'calendar', 'messages'];

// ─── Mobile bottom bar — Overview, Bookings, Calendar + More (rest live in a sheet) ──
export function AdminMobileNav({ active, items, onMore }: { active: AdminNavKey; items: AdminNavItem[]; onMore: () => void }) {
  const resumeBooking = useResumeBooking();
  const primary = MOBILE_PRIMARY.map(k => items.find(i => i.key === k)!).filter(Boolean);
  const moreActive = !MOBILE_PRIMARY.includes(active);
  return (
    <nav aria-label="CRM navigation" className="crm-mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-40 bg-navy-800/95 backdrop-blur border-t border-white/10 safe-bottom">
      <div className="grid grid-cols-5">
        {primary.map(item => {
          const Icon = item.icon;
          const on = active === item.key;
          const cls = "crm-mobile-item relative cursor-pointer text-[11px] font-semibold";
          const badge = !!item.badge && (
            <span className="absolute top-1 right-[22%] min-w-[15px] h-4 px-1 bg-amber-400 text-navy-900 text-[10px] font-bold rounded-full flex items-center justify-center">{item.badge}</span>
          );
          return item.onClick ? (
            <button key={item.key} onClick={() => { if (!resumeBooking(item)) item.onClick?.(); }} className={cls} data-selected={on} aria-current={on ? "page" : undefined}>
              <span className="crm-mobile-icon"><Icon className="size-5" /></span>{item.label}{badge}
            </button>
          ) : (
            <Link key={item.key} href={item.href!} onClick={event => { if (resumeBooking(item)) event.preventDefault(); }} className={cls} data-selected={on} aria-current={on ? "page" : undefined}>
              <span className="crm-mobile-icon"><Icon className="size-5" /></span>{item.label}{badge}
            </Link>
          );
        })}
        <button onClick={onMore} data-selected={moreActive} aria-haspopup="dialog" className="crm-mobile-item cursor-pointer text-[11px] font-semibold">
          <span className="crm-mobile-icon"><Menu className="size-5" /></span>More
        </button>
      </div>
    </nav>
  );
}

// ─── Mobile "More" sheet — everything past the 3 primary tabs ──────────────
export function AdminMoreSheet({ open, onClose, active, items }: { open: boolean; onClose: () => void; active: AdminNavKey; items: AdminNavItem[] }) {
  const logout = useLogout();
  const rest = items.filter(i => !MOBILE_PRIMARY.includes(i.key));
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="More" className="crm-more-sheet flex max-h-[80dvh] w-full flex-col rounded-t-2xl border border-white/10 bg-navy-800" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3"><h3 className="text-white font-semibold">More</h3><StaffProfileSelect /></div>
          <button onClick={onClose} aria-label="Close" className="crm-sheet-close text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
          {rest.map(item => {
            const Icon = item.icon;
            const on = active === item.key;
            const cls = `w-full flex items-center gap-3 min-h-12 p-3 rounded-lg text-left cursor-pointer text-sm font-medium transition-colors ${on ? 'text-sky-400 bg-sky-400/10' : 'text-white hover:bg-white/5'}`;
            const inner = (
              <>
                <Icon className="w-5 h-5 flex-shrink-0" /> {item.label}
                {!!item.badge && <span className="ml-auto w-5 h-5 bg-amber-400/20 text-amber-400 text-xs rounded-full flex items-center justify-center font-bold">{item.badge}</span>}
                {!item.badge && item.warn && <span title={item.warn} className="ml-auto w-5 h-5 bg-amber-400 text-navy-900 text-xs rounded-full flex items-center justify-center font-extrabold">!</span>}
              </>
            );
            return item.onClick ? (
              <button key={item.key} onClick={() => { item.onClick!(); onClose(); }} className={cls}>{inner}</button>
            ) : (
              <Link key={item.key} href={item.href!} onClick={onClose} className={cls}>{inner}</Link>
            );
          })}
          <a href="/" target="_blank" className="w-full flex items-center gap-3 p-3 rounded-lg text-left cursor-pointer text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors">
            ← View website
          </a>
          <button onClick={logout} className="w-full flex items-center gap-3 p-3 rounded-lg text-left cursor-pointer text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors">
            <LogOut className="w-5 h-5 flex-shrink-0" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

// Convenience: local open/close state for the More sheet, used by every page.
export function useMoreSheet() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}
