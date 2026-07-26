'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard, Calendar as CalendarIcon, CalendarClock, FileText, Repeat,
  BarChart3, Globe, Users, Settings as SettingsIcon, LogOut, Menu, X,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/version';

// Single source of truth for admin nav order: Overview, Bookings, Calendar,
// Invoices, Recurring Plans, Business Stats, Site Stats, Guest Logins, Settings.
export type AdminNavKey = 'overview' | 'bookings' | 'calendar' | 'invoices' | 'recurring' | 'business' | 'site' | 'guests' | 'settings';

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;        // navigate here
  onClick?: () => void; // or run this instead (in-page tab switch, no navigation)
  badge?: number;
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
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, ...tabItem('overview') },
    { key: 'bookings', label: 'Bookings', icon: CalendarIcon, badge: pending, ...tabItem('bookings') },
    { key: 'calendar', label: 'Calendar', icon: CalendarClock, href: '/admin/calendar' },
    { key: 'invoices', label: 'Invoices', icon: FileText, href: '/admin/invoices' },
    { key: 'recurring', label: 'Recurring Plans', icon: Repeat, href: '/admin/recurring' },
    { key: 'business', label: 'Business Stats', icon: BarChart3, ...tabItem('business') },
    { key: 'site', label: 'Site Stats', icon: Globe, ...tabItem('site') },
    { key: 'guests', label: 'Guest Logins', icon: Users, href: '/admin/guests' },
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

function NavLink({ item, active, className }: { item: AdminNavItem; active: boolean; className: string }) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="w-4 h-4" /> {item.label}
      {!!item.badge && (
        <span className="ml-auto w-5 h-5 bg-amber-400/20 text-amber-400 text-xs rounded-full flex items-center justify-center font-bold">
          {item.badge}
        </span>
      )}
    </>
  );
  const cls = `${className} ${active ? 'active' : ''}`;
  return item.onClick
    ? <button onClick={item.onClick} className={cls}>{content}</button>
    : <Link href={item.href!} className={cls}>{content}</Link>;
}

// ─── Desktop sidebar — persistent on lg+, never goes fullscreen ────────────
export function AdminSidebar({ active, items }: { active: AdminNavKey; items: AdminNavItem[] }) {
  const logout = useLogout();
  return (
    <aside className="w-64 flex-shrink-0 hidden lg:flex flex-col bg-navy-800 border-r border-white/5 p-6">
      <div className="mb-8">
        <Image src="/logo.png" alt="Glass & Blast" width={200} height={80} className="object-contain h-16 w-auto" />
        <div className="text-sky-400 text-[10px] tracking-[0.2em] mt-1">ADMIN PANEL</div>
      </div>
      <nav className="flex-1 space-y-1">
        {items.map(item => (
          <NavLink key={item.key} item={item} active={active === item.key} className="admin-sidebar-link w-full" />
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

const MOBILE_PRIMARY: AdminNavKey[] = ['overview', 'bookings', 'calendar'];

// ─── Mobile bottom bar — Overview, Bookings, Calendar + More (rest live in a sheet) ──
export function AdminMobileNav({ active, items, onMore }: { active: AdminNavKey; items: AdminNavItem[]; onMore: () => void }) {
  const primary = MOBILE_PRIMARY.map(k => items.find(i => i.key === k)!).filter(Boolean);
  const moreActive = !MOBILE_PRIMARY.includes(active);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-navy-800/95 backdrop-blur border-t border-white/10 safe-bottom">
      <div className="grid grid-cols-4">
        {primary.map(item => {
          const Icon = item.icon;
          const on = active === item.key;
          const cls = `relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium cursor-pointer transition-colors ${on ? 'text-sky-400' : 'text-slate-500'}`;
          const badge = !!item.badge && (
            <span className="absolute top-1 right-[22%] min-w-[15px] h-4 px-1 bg-amber-400 text-navy-900 text-[10px] font-bold rounded-full flex items-center justify-center">{item.badge}</span>
          );
          return item.onClick ? (
            <button key={item.key} onClick={item.onClick} className={cls}>
              <Icon className="w-[21px] h-[21px]" /> {item.label}{badge}
            </button>
          ) : (
            <Link key={item.key} href={item.href!} className={cls}>
              <Icon className="w-[21px] h-[21px]" /> {item.label}{badge}
            </Link>
          );
        })}
        <button onClick={onMore} className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium cursor-pointer transition-colors ${moreActive ? 'text-sky-400' : 'text-slate-500'}`}>
          <Menu className="w-[21px] h-[21px]" /> More
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
      <div className="bg-navy-800 border border-white/10 rounded-t-2xl w-full max-h-[80svh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-white font-semibold">More</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
          {rest.map(item => {
            const Icon = item.icon;
            const on = active === item.key;
            const cls = `w-full flex items-center gap-3 p-3 rounded-lg text-left cursor-pointer text-sm font-medium transition-colors ${on ? 'text-sky-400 bg-sky-400/10' : 'text-white hover:bg-white/5'}`;
            const inner = (
              <>
                <Icon className="w-5 h-5 flex-shrink-0" /> {item.label}
                {!!item.badge && <span className="ml-auto w-5 h-5 bg-amber-400/20 text-amber-400 text-xs rounded-full flex items-center justify-center font-bold">{item.badge}</span>}
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
