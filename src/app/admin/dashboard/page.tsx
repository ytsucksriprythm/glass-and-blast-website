'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, LineChart, Line,
} from 'recharts';
import {
  LayoutDashboard, Calendar, LogOut, TrendingUp,
  Clock, CheckCircle, XCircle, Trash2, ChevronUp,
  ChevronDown, Search, RefreshCw, DollarSign,
  ArrowUpRight, ArrowDownRight, Edit3, Check, Plus, X, StickyNote, BadgeCheck, Wallet,
  BarChart3, Globe, Eye, Users, Link2, MapPin, Target, ClipboardCopy, CalendarDays, CalendarPlus, ArrowRight,
  Repeat, PhoneCall,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Booking, BookingStatus, RecurringJob } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────

interface Stats {
  total: number; thisMonth: number; lastMonth: number;
  pending: number; quoted: number; confirmed: number; completed: number; cancelled: number;
  quotedCount: number; quotedValue: number;
  paidValue: number; owedValue: number; owedCount: number;
  wonValue: number; estimatedRevenue: number;
  byMonth: { month: string; count: number }[];
  serviceBreakdown: { name: string; value: number }[];
  avgPerMonth: number;
}

interface BusinessStats {
  total: number; completed: number; conversionRate: number; avgQuote: number;
  paidValue: number; owedValue: number; quotedCount: number;
  leadsBySource: { website: number; manual: number };
  revByMonth: { month: string; revenue: number }[];
  topSuburbs: { suburb: string; count: number }[];
  serviceBreakdown: { name: string; value: number }[];
}

interface SiteStats {
  allTimeViews: number; views30d: number; today: number; last7: number;
  uniqueVisitors: number; directShare: number;
  byDay: { day: string; views: number }[];
  topPages: { path: string; views: number }[];
  topReferrers: { source: string; views: number }[];
}

type CalJob = { uid: string; title: string; location: string; dow: string; day: string; mon: string; timeLabel: string; allDay: boolean };
type CalData = { configured: boolean; events: CalJob[] };

// ─── Constants ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: React.FC<{ className?: string; style?: React.CSSProperties }> }> = {
  pending:   { label: 'Pending',   color: '#F59E0B', icon: Clock },
  quoted:    { label: 'Quoted',    color: '#A78BFA', icon: DollarSign },
  confirmed: { label: 'Confirmed', color: '#38BDF8', icon: CheckCircle },
  completed: { label: 'Completed', color: '#34D399', icon: Check },
  cancelled: { label: 'Cancelled', color: '#F87171', icon: XCircle },
};
const STATUS_KEYS = Object.keys(STATUS_CONFIG) as BookingStatus[];

const SERVICE_LABELS: Record<string, string> = {
  'window-washing':       'Window Washing',
  'pressure-washing':     'Pressure Washing',
  'both':                 'Both Services',
  'flyscreen-repair':     'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'other':                'Other',
};

const PIE_COLORS = ['#38BDF8', '#818CF8', '#34D399', '#FBBF24', '#F472B6', '#94A3B8'];

const money = (n?: number | null) =>
  typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '';

// A booking's service can be a comma-separated list of keys. Render readable labels.
const serviceText = (service: string) =>
  (service ?? '')
    .split(',')
    .filter(Boolean)
    .map(s => SERVICE_LABELS[s] ?? s)
    .join(' + ') || '—';

// Google Calendar "new event" link, pre-filled with the job details.
// Deliberately omits `dates`, so the date and time are left blank for you to set.
function gcalUrl(b: Booking): string {
  // Title format the owners asked for: "address - name", e.g. "10 House St, Aranda - John Smith".
  const place = [b.address, b.suburb].filter(Boolean).join(', ');
  const title = (place ? `${place} - ${b.name}` : b.name).trim();
  const location = place;
  const details = [
    b.phone ? `Phone: ${b.phone}` : '',
    b.email ? `Email: ${b.email}` : '',
    `Service: ${serviceText(b.service)}`,
    b.propertyType ? `Type: ${b.propertyType}` : '',
    typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? `Quote: ${money(b.quoteAmount)}` : '',
    (b.preferredDate || b.preferredTime) ? `Preferred: ${[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}` : '',
    b.notes ? `Customer note: ${b.notes}` : '',
    b.adminNotes ? `Admin note: ${b.adminNotes}` : '',
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, details, location });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const emptyForm = {
  name: '', phone: '', email: '', service: 'window-washing', propertyType: 'residential',
  suburb: '', address: '', preferredDate: '', preferredTime: '', status: 'pending',
  quoteAmount: '', notes: '', adminNotes: '',
};

// Selectable service options (multi-select). 'both' is legacy, not offered for new bookings.
const SERVICE_OPTIONS: { v: string; l: string }[] = [
  { v: 'window-washing', l: 'Window Washing' },
  { v: 'pressure-washing', l: 'Pressure Washing' },
  { v: 'flyscreen-repair', l: 'Flyscreen Repair' },
  { v: 'solar-panel-cleaning', l: 'Solar Panel Cleaning' },
  { v: 'other', l: 'Other' },
];

// ─── Sub-components ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, trend, color = '#38BDF8' }: {
  label: string; value: string | number; sub?: string;
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>; trend?: number; color?: string;
}) {
  return (
    <motion.div whileHover={{ y: -2 }} className="glass rounded-2xl border border-white/8 p-6 hover:border-sky-400/20 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}20` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="font-display text-3xl font-bold text-white">{value}</div>
      <div className="text-slate-400 text-sm mt-1">{label}</div>
      {sub && <div className="text-slate-600 text-xs mt-0.5">{sub}</div>}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold badge-${status}`}>
      <cfg.icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-slate-400 text-xs font-medium mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// Labelled progress bar used in the Business Stats tab.
function SourceRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-semibold">{value} <span className="text-slate-500">({pct}%)</span></span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ─── Upcoming jobs (read-only Google Calendar feed) ──────────────────────

// Match a calendar event to a booking. Events are titled "address - name", so the
// booking's name (and/or address) appears in the title.
function matchBooking(title: string, bookings: Booking[]): Booking | undefined {
  const t = title.toLowerCase();
  return bookings.find(b => b.name && t.includes(b.name.toLowerCase().trim()))
    || bookings.find(b => b.address && b.address.length > 3 && t.includes(b.address.toLowerCase().trim()));
}

function UpcomingJobs({ data, bookings }: { data: CalData | null; bookings: Booking[] }) {
  return (
    <div className="glass rounded-2xl border border-white/8 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-white flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-sky-400" /> Upcoming jobs
        </h3>
        <span className="text-slate-600 text-xs">Google Calendar</span>
      </div>
      {!data ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />)}</div>
      ) : !data.configured ? (
        <p className="text-slate-500 text-sm leading-relaxed">
          Not connected yet. Add your calendar&apos;s secret iCal URL to <code className="text-slate-400 bg-white/5 px-1 py-0.5 rounded">GOOGLE_CALENDAR_ICS_URL</code> and upcoming jobs show up here.
        </p>
      ) : (() => {
        // Hide jobs whose matched booking is already marked completed.
        const visible = data.events.filter(e => matchBooking(e.title, bookings)?.status !== 'completed');
        if (visible.length === 0) return <p className="text-slate-500 text-sm">No upcoming jobs on the calendar.</p>;
        return (
        <ul className="divide-y divide-white/5">
          {visible.map(e => {
            const match = matchBooking(e.title, bookings);
            return (
              <li key={e.uid} className="flex items-center gap-3 py-2.5">
                <div className="flex-shrink-0 w-11 text-center">
                  <div className="text-sky-400 text-[10px] font-semibold uppercase leading-none">{e.dow}</div>
                  <div className="text-white font-bold text-lg leading-tight">{e.day}</div>
                  <div className="text-slate-500 text-[10px] leading-none">{e.mon}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium truncate">{e.title}</div>
                  <div className="text-slate-500 text-xs truncate">
                    {e.timeLabel}{e.location ? ` · ${e.location}` : ''}
                  </div>
                </div>
                {match && (
                  <Link
                    href={`/admin/bookings/${match.id}?from=${encodeURIComponent('/admin/dashboard?tab=overview')}`}
                    title={`Open booking: ${match.name}`}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sky-400 bg-sky-400/10 hover:bg-sky-400/20 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Booking <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        );
      })()}
    </div>
  );
}

// ─── Bottom tab bar (mobile / installed app) ─────────────────────────────

type TabKey = 'overview' | 'bookings' | 'business' | 'site';

function BottomNav({ active, onChange, pending }: { active: TabKey; onChange: (t: TabKey) => void; pending: number }) {
  const tabs = [
    { t: 'overview', label: 'Home', icon: LayoutDashboard },
    { t: 'bookings', label: 'Bookings', icon: Calendar },
    { t: 'business', label: 'Business', icon: BarChart3 },
    { t: 'site', label: 'Site', icon: Globe },
  ] as const;
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-navy-800/95 backdrop-blur border-t border-white/10 safe-bottom">
      <div className="grid grid-cols-4">
        {tabs.map(({ t, label, icon: Icon }) => {
          const on = active === t;
          return (
            <button key={t} onClick={() => onChange(t)} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium cursor-pointer transition-colors ${on ? 'text-sky-400' : 'text-slate-500'}`}>
              <Icon className="w-[22px] h-[22px]" />
              {label}
              {t === 'bookings' && pending > 0 && (
                <span className="absolute top-1 right-[22%] min-w-[16px] h-4 px-1 bg-amber-400 text-navy-900 text-[10px] font-bold rounded-full flex items-center justify-center">{pending}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'business' | 'site'>('overview');

  // Restore the tab from ?tab=… so returning from a booking detail (Back button)
  // lands on the same tab it was opened from, not the default. Runs before data
  // loads, so the swap happens behind the loading skeletons — no visible flash.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'bookings' || t === 'business' || t === 'site' || t === 'overview') {
      setActiveTab(t);
    }
  }, []);

  // Stats for the dedicated tabs (lazy-loaded when first opened)
  const [bizStats, setBizStats] = useState<BusinessStats | null>(null);
  const [siteStats, setSiteStats] = useState<SiteStats | null>(null);
  const [bizLoading, setBizLoading] = useState(false);
  const [siteLoading, setSiteLoading] = useState(false);

  // Upcoming jobs from the read-only Google Calendar feed
  const [jobs, setJobs] = useState<CalData | null>(null);

  // Recurring plans (for the overview "due soon" card)
  const [recurring, setRecurring] = useState<RecurringJob[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/recurring');
        if (res.ok) setRecurring(await res.json());
      } catch { /* card just stays hidden */ }
    })();
  }, []);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Modals
  const [manage, setManage] = useState<Booking | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, bRes] = await Promise.all([
        fetch('/api/admin/bookings?type=stats'),
        fetch(`/api/admin/bookings?status=${statusFilter}&service=${serviceFilter}&sort=${sortField}&order=${sortOrder}&search=${encodeURIComponent(search)}`),
      ]);
      if (sRes.status === 401 || bRes.status === 401) { router.push('/admin'); return; }
      setStats(await sRes.json());
      setBookings(await bRes.json());
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [statusFilter, serviceFilter, sortField, sortOrder, search, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Load upcoming jobs once on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/calendar');
        if (res.status === 401) { router.push('/admin'); return; }
        setJobs(await res.json());
      } catch { /* leave as loading skeleton */ }
    })();
  }, [router]);

  const fetchBusiness = useCallback(async () => {
    setBizLoading(true);
    try {
      const res = await fetch('/api/admin/analytics?type=business');
      if (res.status === 401) { router.push('/admin'); return; }
      setBizStats(await res.json());
    } catch { toast.error('Failed to load business stats'); }
    finally { setBizLoading(false); }
  }, [router]);

  const fetchSite = useCallback(async () => {
    setSiteLoading(true);
    try {
      const res = await fetch('/api/admin/analytics?type=site');
      if (res.status === 401) { router.push('/admin'); return; }
      setSiteStats(await res.json());
    } catch { toast.error('Failed to load site stats'); }
    finally { setSiteLoading(false); }
  }, [router]);

  // Lazy-load each analytics tab the first time it's opened.
  useEffect(() => {
    if (activeTab === 'business' && !bizStats && !bizLoading) fetchBusiness();
    if (activeTab === 'site' && !siteStats && !siteLoading) fetchSite();
  }, [activeTab, bizStats, siteStats, bizLoading, siteLoading, fetchBusiness, fetchSite]);

  const logout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin');
  };

  // Tap a booking (card or row) to see its full read-only detail page. Pass the
  // current tab as ?from=… so the detail page's Back button returns here exactly.
  const openBooking = (id: string) => router.push(`/admin/bookings/${id}?from=${encodeURIComponent(`/admin/dashboard?tab=${activeTab}`)}`);

  // Quick inline status change. "Quoted" opens the manage modal to capture the amount.
  const onInlineStatus = (b: Booking, val: BookingStatus) => {
    if (val === 'quoted') { setManage({ ...b, status: 'quoted' }); return; }
    saveBooking(b.id, { status: val });
  };

  const onTogglePaid = (b: Booking) => saveBooking(b.id, { paid: !b.paid });

  const saveBooking = async (id: string, patch: Partial<Booking>) => {
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      toast.success('Saved');
      await fetchData();
    } catch { toast.error('Save failed'); }
  };

  const removeBooking = async (id: string) => {
    if (!confirm('Delete this booking?')) return;
    try {
      await fetch(`/api/admin/bookings/${id}`, { method: 'DELETE' });
      setBookings(prev => prev.filter(b => b.id !== id));
      toast.success('Booking deleted');
      fetchData();
    } catch { toast.error('Delete failed'); }
  };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  // Copy every booking as readable text — for pasting into Claude / notes.
  const exportBookings = async () => {
    try {
      const res = await fetch('/api/admin/bookings?status=all&service=all&sort=createdAt&order=desc&search=');
      if (res.status === 401) { router.push('/admin'); return; }
      const all: Booking[] = await res.json();
      if (!Array.isArray(all) || all.length === 0) { toast.error('No bookings to export'); return; }

      const blocks = all.map((b, i) => {
        const lines = [
          `${i + 1}. ${b.name}${b.phone ? ` — ${b.phone}` : ''}`,
          `   Service: ${serviceText(b.service)} | ${b.propertyType}`,
          `   Status: ${STATUS_CONFIG[b.status]?.label ?? b.status} | Paid: ${b.paid ? 'yes' : 'no'}${typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? ` | Quote: ${money(b.quoteAmount)}` : ''}`,
        ];
        if (b.preferredDate || b.preferredTime) lines.push(`   When: ${[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}`);
        if (b.address || b.suburb) lines.push(`   Address: ${[b.address, b.suburb].filter(Boolean).join(', ')}`);
        if (b.email) lines.push(`   Email: ${b.email}`);
        if (b.notes) lines.push(`   Customer note: ${b.notes}`);
        if (b.adminNotes) lines.push(`   Admin note: ${b.adminNotes}`);
        lines.push(`   Source: ${b.source} | Created: ${new Date(b.createdAt).toLocaleDateString('en-AU')}`);
        return lines.join('\n');
      });

      const text = `Glass & Blast — Bookings export\nGenerated: ${new Date().toLocaleString('en-AU')}\nTotal: ${all.length}\n\n${blocks.join('\n\n')}`;

      try {
        await navigator.clipboard.writeText(text);
        toast.success(`Copied ${all.length} bookings to clipboard`);
      } catch {
        // Clipboard blocked (rare) — fall back to a text-file download.
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url; a.download = `bookings-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click(); URL.revokeObjectURL(url);
        toast.success(`Downloaded ${all.length} bookings`);
      }
    } catch { toast.error('Export failed'); }
  };

  const SortIcon = ({ field }: { field: string }) => (
    sortField === field
      ? sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3 opacity-30" />
  );

  const monthTrend = stats && stats.lastMonth > 0
    ? Math.round(((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100)
    : undefined;

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 hidden lg:flex flex-col bg-navy-800 border-r border-white/5 p-6">
        <div className="mb-8">
          <Image src="/logo.png" alt="Glass & Blast" width={200} height={80} className="object-contain h-16 w-auto" />
          <div className="text-sky-400 text-[10px] tracking-[0.2em] mt-1">ADMIN PANEL</div>
        </div>

        <nav className="flex-1 space-y-1">
          <button onClick={() => setActiveTab('overview')} className={`admin-sidebar-link w-full ${activeTab === 'overview' ? 'active' : ''}`}>
            <LayoutDashboard className="w-4 h-4" /> Overview
          </button>
          <button onClick={() => setActiveTab('bookings')} className={`admin-sidebar-link w-full ${activeTab === 'bookings' ? 'active' : ''}`}>
            <Calendar className="w-4 h-4" /> Bookings
            {stats && stats.pending > 0 && (
              <span className="ml-auto w-5 h-5 bg-amber-400/20 text-amber-400 text-xs rounded-full flex items-center justify-center font-bold">
                {stats.pending}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab('business')} className={`admin-sidebar-link w-full ${activeTab === 'business' ? 'active' : ''}`}>
            <BarChart3 className="w-4 h-4" /> Business Stats
          </button>
          <button onClick={() => setActiveTab('site')} className={`admin-sidebar-link w-full ${activeTab === 'site' ? 'active' : ''}`}>
            <Globe className="w-4 h-4" /> Site Stats
          </button>
          <Link href="/admin/recurring" className="admin-sidebar-link w-full">
            <Repeat className="w-4 h-4" /> Recurring Plans
          </Link>
        </nav>

        <div className="border-t border-white/5 pt-4 space-y-2">
          <a href="/" target="_blank" className="admin-sidebar-link block text-xs">← View website</a>
          <button onClick={logout} className="admin-sidebar-link w-full text-red-400 hover:text-red-300 hover:bg-red-400/5">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-white/5 bg-navy-800/80 backdrop-blur px-4 sm:px-6 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)' }}>
          <div>
            <h1 className="font-display text-lg sm:text-xl font-bold text-white">
              {activeTab === 'overview' ? 'Dashboard Overview'
                : activeTab === 'bookings' ? 'Bookings & Quotes'
                : activeTab === 'business' ? 'Business Statistics'
                : 'Site Statistics'}
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => { setActiveTab('bookings'); setShowAdd(true); }} className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer">
              <Plus className="w-4 h-4" /> Add Booking
            </button>
            <button onClick={() => { if (activeTab === 'business') fetchBusiness(); else if (activeTab === 'site') fetchSite(); else fetchData(); }} className="p-2 rounded-xl glass border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <RefreshCw className={`w-4 h-4 ${(loading || bizLoading || siteLoading) ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={logout} className="lg:hidden p-2 rounded-xl glass border border-white/10 text-red-400 cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6 space-y-6 pb-28 lg:pb-6">
          <AnimatePresence mode="wait">
            {/* ── OVERVIEW ─────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {loading ? (
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-6 h-32 animate-pulse" />)}
                  </div>
                ) : stats && (
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard label="Total Bookings" value={stats.total} icon={Calendar} color="#38BDF8" sub="All time" />
                    <StatCard label="This Month" value={stats.thisMonth} icon={TrendingUp} color="#818CF8" trend={monthTrend} sub={`vs ${stats.lastMonth} last month`} />
                    <StatCard label="Quoted" value={money(stats.quotedValue) || '$0'} icon={DollarSign} color="#A78BFA" sub={`${stats.quotedCount} quote${stats.quotedCount !== 1 ? 's' : ''} out`} />
                    <StatCard label="Revenue (paid)" value={money(stats.paidValue) || '$0'} icon={CheckCircle} color="#34D399" sub="Money collected" />
                    <StatCard label="Owed" value={money(stats.owedValue) || '$0'} icon={Wallet} color="#F87171" sub={`${stats.owedCount} job${stats.owedCount !== 1 ? 's' : ''} unpaid`} />
                  </div>
                )}

                {stats && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {STATUS_KEYS.map((key) => {
                      const cfg = STATUS_CONFIG[key];
                      return (
                        <div key={key} className="glass rounded-xl border border-white/8 p-4 flex items-center gap-3">
                          <cfg.icon className="w-4 h-4 flex-shrink-0" style={{ color: cfg.color }} />
                          <div>
                            <div className="text-white font-bold text-lg">{stats[key]}</div>
                            <div className="text-slate-500 text-xs">{cfg.label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Action needed: fresh leads to call + money owed — the two lists that make you money */}
                {!loading && (() => {
                  const leads = bookings.filter(b => b.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5);
                  const owed = bookings.filter(b => b.status === 'completed' && !b.paid && typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0).slice(0, 5);
                  const dueSoonCount = recurring.filter(j => j.active && j.nextDate <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)).length;
                  const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
                  if (leads.length === 0 && owed.length === 0 && recurring.length === 0) return null;
                  return (
                    <div className="grid lg:grid-cols-2 gap-4">
                      {leads.length > 0 && (
                        <div className="glass rounded-2xl border border-amber-400/20 p-5">
                          <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                            <PhoneCall className="w-4 h-4 text-amber-400" /> Leads to call back
                            <span className="ml-auto text-amber-400 text-xs font-bold">{leads.length}</span>
                          </h3>
                          <ul className="divide-y divide-white/5">
                            {leads.map(b => (
                              <li key={b.id} className="flex items-center gap-3 py-2">
                                <button onClick={() => openBooking(b.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                                  <div className="text-white text-sm font-medium truncate">{b.name}</div>
                                  <div className="text-slate-500 text-xs truncate">{serviceText(b.service)}{b.suburb ? ` · ${b.suburb}` : ''}</div>
                                </button>
                                <span className={`flex-shrink-0 text-xs ${ageDays(b.createdAt) >= 2 ? 'text-amber-400 font-semibold' : 'text-slate-500'}`}>
                                  {ageDays(b.createdAt) === 0 ? 'today' : `${ageDays(b.createdAt)}d`}
                                </span>
                                {b.phone && (
                                  <a href={`tel:${b.phone}`} aria-label={`Call ${b.name}`} className="flex-shrink-0 w-9 h-9 rounded-lg bg-sky-400/10 text-sky-400 hover:bg-sky-400/20 flex items-center justify-center cursor-pointer">
                                    <PhoneCall className="w-4 h-4" />
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="space-y-4">
                        {owed.length > 0 && (
                          <div className="glass rounded-2xl border border-red-400/20 p-5">
                            <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                              <Wallet className="w-4 h-4 text-red-400" /> Done but not paid
                              <span className="ml-auto text-red-300 text-xs font-bold">{money(owed.reduce((s, b) => s + (b.quoteAmount ?? 0), 0))}</span>
                            </h3>
                            <ul className="divide-y divide-white/5">
                              {owed.map(b => (
                                <li key={b.id}>
                                  <button onClick={() => openBooking(b.id)} className="w-full flex items-center gap-3 py-2 text-left cursor-pointer">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-white text-sm font-medium truncate">{b.name}</div>
                                      <div className="text-slate-500 text-xs">{b.completedAt ? `Done ${new Date(b.completedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : 'Completed'}</div>
                                    </div>
                                    <span className="flex-shrink-0 text-red-300 text-sm font-semibold">{money(b.quoteAmount)}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <Link href="/admin/recurring" className="glass rounded-2xl border border-white/8 p-5 flex items-center gap-3 hover:border-sky-400/30 transition-colors cursor-pointer">
                          <span className="w-10 h-10 rounded-xl bg-sky-400/10 flex items-center justify-center flex-shrink-0">
                            <Repeat className="w-5 h-5 text-sky-400" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-white text-sm font-semibold">Recurring plans</span>
                            <span className="block text-slate-500 text-xs mt-0.5">
                              {recurring.filter(j => j.active).length} active{dueSoonCount > 0 ? ` · ${dueSoonCount} due within 2 weeks` : ''}
                            </span>
                          </span>
                          <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        </Link>
                      </div>
                    </div>
                  );
                })()}

                <UpcomingJobs data={jobs} bookings={bookings} />

                {stats && (
                  <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-6">Bookings by Month</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={stats.byMonth} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ background: '#0F2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }} cursor={{ fill: 'rgba(56,189,248,0.05)' }} />
                          <Bar dataKey="count" name="Bookings" fill="#38BDF8" radius={[6, 6, 0, 0]} maxBarSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-6">Services</h3>
                      {stats.serviceBreakdown.every(s => s.value === 0) ? (
                        <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm">No data yet</div>
                      ) : (
                        <>
                          <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                              <Pie data={stats.serviceBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                                {stats.serviceBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                              </Pie>
                              <Tooltip contentStyle={{ background: '#0F2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-2 mt-2">
                            {stats.serviceBreakdown.map((s, i) => (
                              <div key={s.name} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  <span className="text-slate-400">{s.name}</span>
                                </div>
                                <span className="text-white font-semibold">{s.value}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── BOOKINGS ─────────────────────────────────────────────── */}
            {activeTab === 'bookings' && (
              <motion.div key="bookings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {/* Filters + add */}
                <div className="glass rounded-2xl border border-white/8 p-3 sm:p-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input className="form-input pl-9 py-2.5 text-sm" placeholder="Search name, phone, address..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    <select className="form-input py-2.5 text-sm w-full sm:w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                      <option value="all">All Status</option>
                      {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                    </select>
                    <select className="form-input py-2.5 text-sm w-full sm:w-auto" value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
                      <option value="all">All Services</option>
                      <option value="window-washing">Window</option>
                      <option value="pressure-washing">Pressure</option>
                      <option value="both">Both</option>
                      <option value="flyscreen-repair">Flyscreen</option>
                      <option value="solar-panel-cleaning">Solar Panel</option>
                      <option value="other">Other</option>
                    </select>
                    <button onClick={exportBookings} title="Copy all bookings as text (for pasting into Claude / notes)" className="inline-flex items-center justify-center gap-2 px-4 py-2.5 glass border border-white/10 text-slate-300 hover:text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap">
                      <ClipboardCopy className="w-4 h-4" /> Export
                    </button>
                    <button onClick={() => setShowAdd(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap">
                      <Plus className="w-4 h-4" /> Add Booking
                    </button>
                  </div>
                </div>

                <div className="text-slate-500 text-sm px-1">
                  {loading ? 'Loading...' : `${bookings.length} booking${bookings.length !== 1 ? 's' : ''}`}
                </div>

                {/* Mobile cards (phone-first) */}
                <div className="lg:hidden space-y-3">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-4 h-32 animate-pulse" />)
                  ) : bookings.length === 0 ? (
                    <div className="glass rounded-2xl border border-white/8 p-10 text-center text-slate-600">
                      <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" /> No bookings found
                    </div>
                  ) : bookings.map((b) => (
                    <div key={b.id} className="glass rounded-2xl border border-white/8 p-4">
                      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => openBooking(b.id)}>
                        <div className="min-w-0">
                          <div className="text-white font-semibold flex items-center gap-2 flex-wrap">
                            {b.name}
                            {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
                          </div>
                          <a href={`tel:${b.phone}`} onClick={e => e.stopPropagation()} className="text-sky-400 text-sm cursor-pointer">{b.phone}</a>
                          <div className="text-slate-500 text-xs mt-0.5">{serviceText(b.service)} · <span className="capitalize">{b.propertyType}</span></div>
                        </div>
                        {typeof b.quoteAmount === 'number' && b.quoteAmount > 0 && (
                          <div className="text-violet-300 font-bold text-lg whitespace-nowrap">{money(b.quoteAmount)}</div>
                        )}
                      </div>
                      {(b.preferredDate || b.suburb || b.address) && (
                        <div className="text-slate-500 text-xs mt-2">
                          {[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}
                          {(b.preferredDate || b.preferredTime) && (b.suburb || b.address) ? ' · ' : ''}
                          {b.suburb}{b.address ? `, ${b.address}` : ''}
                        </div>
                      )}
                      {b.adminNotes && (
                        <div className="text-slate-400 text-xs mt-2 flex items-start gap-1.5">
                          <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-500" /> {b.adminNotes}
                        </div>
                      )}
                      <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                        <select
                          value={b.status}
                          onChange={e => onInlineStatus(b, e.target.value as BookingStatus)}
                          className={`w-full text-sm font-semibold rounded-lg px-3 py-2.5 cursor-pointer bg-transparent border focus:outline-none badge-${b.status}`}
                        >
                          {STATUS_KEYS.map(s => <option key={s} value={s} className="bg-navy-800 text-white">{STATUS_CONFIG[s].label}</option>)}
                        </select>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onTogglePaid(b)}
                            title={b.paid ? 'Mark unpaid' : 'Mark paid'}
                            className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-all cursor-pointer ${b.paid ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-red-500/15 border-red-400/40 text-red-300'}`}
                          >
                            {b.paid ? '✓ Paid' : 'Not Paid'}
                          </button>
                          <button onClick={() => setManage(b)} className="p-2.5 rounded-lg glass border border-white/10 text-sky-400 cursor-pointer" title="Manage / notes / quote">
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <a href={gcalUrl(b)} target="_blank" rel="noopener noreferrer" className="p-2.5 rounded-lg glass border border-white/10 text-sky-300 cursor-pointer" title="Add to Google Calendar">
                            <CalendarPlus className="w-4 h-4" />
                          </a>
                          <button onClick={() => removeBooking(b.id)} className="p-2.5 rounded-lg glass border border-white/10 text-red-400 cursor-pointer" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Table (desktop) */}
                <div className="hidden lg:block glass rounded-2xl border border-white/8 overflow-hidden">
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_3rem_auto] gap-4 px-6 py-3 border-b border-white/5 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-white/2">
                    {[
                      { label: 'Customer', field: 'name' },
                      { label: 'Service', field: 'service' },
                      { label: 'Date', field: 'preferredDate' },
                      { label: 'Status', field: 'status' },
                      { label: 'Quote', field: 'quoteAmount' },
                    ].map(col => (
                      <button key={col.field} onClick={() => toggleSort(col.field)} className="flex items-center gap-1 text-left cursor-pointer hover:text-slate-300 transition-colors">
                        {col.label} <SortIcon field={col.field} />
                      </button>
                    ))}
                    <div title="Paid?"><BadgeCheck className="w-3.5 h-3.5" /></div>
                    <div>Actions</div>
                  </div>

                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_3rem_auto] gap-4 px-6 py-4 border-b border-white/5 animate-pulse">
                        {Array.from({ length: 7 }).map((_, j) => <div key={j} className="h-4 bg-white/5 rounded" />)}
                      </div>
                    ))
                  ) : bookings.length === 0 ? (
                    <div className="px-6 py-16 text-center text-slate-600">
                      <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      No bookings found
                    </div>
                  ) : (
                    bookings.map((b) => (
                      <motion.div key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_3rem_auto] gap-4 px-6 py-4 border-b border-white/5 hover:bg-white/2 transition-colors items-center">
                        {/* Customer (tap to view full booking) */}
                        <div className="min-w-0 cursor-pointer group" onClick={() => openBooking(b.id)}>
                          <div className="text-white group-hover:text-sky-400 transition-colors text-sm font-medium flex items-center gap-2">
                            {b.name}
                            {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
                          </div>
                          <div className="text-slate-500 text-xs">{b.phone}</div>
                          <div className="text-slate-600 text-xs truncate">{b.suburb}{b.address ? ` · ${b.address}` : ''}</div>
                        </div>
                        {/* Service */}
                        <div>
                          <div className="text-slate-300 text-sm">{serviceText(b.service)}</div>
                          <div className="text-slate-600 text-xs capitalize">{b.propertyType}</div>
                        </div>
                        {/* Date */}
                        <div>
                          <div className="text-slate-300 text-sm">{b.preferredDate || '—'}</div>
                          <div className="text-slate-600 text-xs">{b.preferredTime}</div>
                        </div>
                        {/* Status (inline dropdown) */}
                        <div>
                          <select
                            value={b.status}
                            onChange={e => onInlineStatus(b, e.target.value as BookingStatus)}
                            className={`text-xs font-semibold rounded-lg px-2 py-1 cursor-pointer bg-transparent border focus:outline-none badge-${b.status}`}
                          >
                            {STATUS_KEYS.map(s => <option key={s} value={s} className="bg-navy-800 text-white">{STATUS_CONFIG[s].label}</option>)}
                          </select>
                        </div>
                        {/* Quote */}
                        <div className="text-sm">
                          {typeof b.quoteAmount === 'number' && b.quoteAmount > 0
                            ? <span className="text-violet-300 font-semibold">{money(b.quoteAmount)}</span>
                            : <span className="text-slate-600">—</span>}
                          {b.adminNotes ? <StickyNote className="inline w-3 h-3 ml-1.5 text-slate-500" /> : null}
                        </div>
                        {/* Paid */}
                        <div>
                          <button
                            onClick={() => onTogglePaid(b)}
                            title={b.paid ? 'Mark unpaid' : 'Mark paid'}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${b.paid ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300' : 'bg-red-500/15 border border-red-400/40 text-red-300 hover:bg-red-500/20'}`}
                          >
                            {b.paid ? '✓ Paid' : 'Not Paid'}
                          </button>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-2">
                          <button onClick={() => setManage(b)} className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-400/10 transition-all cursor-pointer" title="Manage / notes / quote">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <a href={gcalUrl(b)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg text-slate-500 hover:text-sky-300 hover:bg-sky-400/10 transition-all cursor-pointer" title="Add to Google Calendar">
                            <CalendarPlus className="w-3.5 h-3.5" />
                          </a>
                          <button onClick={() => removeBooking(b.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all cursor-pointer" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>

                <p className="text-slate-600 text-xs px-1">
                  Change status in the dropdown. Choosing <span className="text-violet-300">Quoted</span> asks for the amount. Click the pencil to add notes or edit a quote.
                </p>
              </motion.div>
            )}

            {/* ── BUSINESS STATS ──────────────────────────────────────── */}
            {activeTab === 'business' && (
              <motion.div key="business" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {bizLoading || !bizStats ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-6 h-32 animate-pulse" />)}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Conversion Rate" value={`${bizStats.conversionRate}%`} icon={Target} color="#34D399" sub={`${bizStats.completed} of ${bizStats.total} completed`} />
                      <StatCard label="Avg Quote" value={money(bizStats.avgQuote) || '$0'} icon={DollarSign} color="#A78BFA" sub={`${bizStats.quotedCount} quoted`} />
                      <StatCard label="Revenue (paid)" value={money(bizStats.paidValue) || '$0'} icon={CheckCircle} color="#38BDF8" sub="Money collected" />
                      <StatCard label="Owed" value={money(bizStats.owedValue) || '$0'} icon={Wallet} color="#F87171" sub="Completed, unpaid" />
                    </div>

                    <div className="grid lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 glass rounded-2xl border border-white/8 p-6">
                        <h3 className="font-display font-semibold text-white mb-6">Revenue (paid) by Month</h3>
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart data={bizStats.revByMonth} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: '#0F2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }} cursor={{ fill: 'rgba(56,189,248,0.05)' }} formatter={(v: number) => money(v)} />
                            <Bar dataKey="revenue" name="Revenue" fill="#34D399" radius={[6, 6, 0, 0]} maxBarSize={48} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="glass rounded-2xl border border-white/8 p-6">
                        <h3 className="font-display font-semibold text-white mb-4">Leads by Source</h3>
                        <div className="space-y-3">
                          <SourceRow label="Website" value={bizStats.leadsBySource.website} total={bizStats.total} color="#38BDF8" />
                          <SourceRow label="Added manually" value={bizStats.leadsBySource.manual} total={bizStats.total} color="#A78BFA" />
                        </div>
                        <h3 className="font-display font-semibold text-white mb-4 mt-6">Service Mix</h3>
                        <div className="space-y-3">
                          {bizStats.serviceBreakdown.map((s, i) => (
                            <SourceRow key={s.name} label={s.name} value={s.value} total={bizStats.total} color={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2"><MapPin className="w-4 h-4 text-sky-400" /> Top Suburbs</h3>
                      {bizStats.topSuburbs.length === 0 ? (
                        <div className="text-slate-600 text-sm py-6 text-center">No suburb data yet</div>
                      ) : (
                        <div className="space-y-2">
                          {bizStats.topSuburbs.map(s => (
                            <div key={s.suburb} className="flex items-center justify-between text-sm">
                              <span className="text-slate-300">{s.suburb}</span>
                              <span className="text-white font-semibold">{s.count} booking{s.count !== 1 ? 's' : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ── SITE STATS (traffic) ────────────────────────────────── */}
            {activeTab === 'site' && (
              <motion.div key="site" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {siteLoading || !siteStats ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-6 h-32 animate-pulse" />)}
                  </div>
                ) : siteStats.allTimeViews === 0 ? (
                  <div className="glass rounded-2xl border border-white/8 p-12 text-center">
                    <Globe className="w-10 h-10 mx-auto mb-4 text-slate-600" />
                    <div className="text-white font-semibold mb-1">No traffic data yet</div>
                    <p className="text-slate-500 text-sm max-w-md mx-auto">Visits are recorded as people browse the public site. Numbers will appear here once visitors land on the site (admin pages aren&apos;t tracked).</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Views Today" value={siteStats.today} icon={Eye} color="#38BDF8" sub="Page views" />
                      <StatCard label="Last 7 Days" value={siteStats.last7} icon={TrendingUp} color="#818CF8" sub="Page views" />
                      <StatCard label="Unique Visitors" value={siteStats.uniqueVisitors} icon={Users} color="#A78BFA" sub="Last 30 days" />
                      <StatCard label="Total Views" value={siteStats.allTimeViews} icon={Globe} color="#34D399" sub="All time" />
                    </div>

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-6">Views — Last 14 Days</h3>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={siteStats.byDay} margin={{ top: 0, right: 8, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ background: '#0F2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }} />
                          <Line type="monotone" dataKey="views" name="Views" stroke="#38BDF8" strokeWidth={2.5} dot={{ r: 3, fill: '#38BDF8' }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-6">
                      <div className="glass rounded-2xl border border-white/8 p-6">
                        <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2"><Eye className="w-4 h-4 text-sky-400" /> Top Pages</h3>
                        <div className="space-y-2">
                          {siteStats.topPages.map(p => (
                            <div key={p.path} className="flex items-center justify-between text-sm gap-3">
                              <span className="text-slate-300 truncate">{p.path}</span>
                              <span className="text-white font-semibold whitespace-nowrap">{p.views}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="glass rounded-2xl border border-white/8 p-6">
                        <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2"><Link2 className="w-4 h-4 text-sky-400" /> Top Referrers</h3>
                        {siteStats.topReferrers.length === 0 ? (
                          <div className="text-slate-600 text-sm py-6 text-center">Mostly direct traffic — no external referrers yet</div>
                        ) : (
                          <div className="space-y-2">
                            {siteStats.topReferrers.map(r => (
                              <div key={r.source} className="flex items-center justify-between text-sm gap-3">
                                <span className="text-slate-300 truncate">{r.source}</span>
                                <span className="text-white font-semibold whitespace-nowrap">{r.views}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-slate-600 text-xs px-1">
                      Privacy-friendly: visitors counted via a daily hash, no raw IPs stored. Admin pages excluded. Charts cover the last 30 days.
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <BottomNav active={activeTab} onChange={setActiveTab} pending={stats?.pending ?? 0} />

      {/* Manage modal */}
      <AnimatePresence>
        {manage && (
          <ManageModal
            booking={manage}
            onClose={() => setManage(null)}
            onSave={async (patch) => { await saveBooking(manage.id, patch); setManage(null); }}
          />
        )}
        {showAdd && (
          <AddModal
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); fetchData(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Manage modal (status / quote / notes) ───────────────────────────────

function ManageModal({ booking, onClose, onSave }: {
  booking: Booking; onClose: () => void; onSave: (patch: Partial<Booking>) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<BookingStatus>(booking.status);
  const [quote, setQuote] = useState<string>(booking.quoteAmount != null ? String(booking.quoteAmount) : '');
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? '');
  const [paid, setPaid] = useState(booking.paid ?? false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const q = quote.trim() === '' ? null : Number(quote.replace(/[^0-9.]/g, ''));
    await onSave({ status, quoteAmount: q, adminNotes, paid });
    setSaving(false);
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-lg font-bold text-white">Manage Booking</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>

      {/* Customer summary */}
      <div className="rounded-xl bg-white/5 border border-white/8 p-4 mb-5 text-sm space-y-1">
        <div className="text-white font-semibold">{booking.name} {booking.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300">Added</span>}</div>
        <div className="text-slate-400">{booking.phone}{booking.email ? ` · ${booking.email}` : ''}</div>
        <div className="text-slate-400">{serviceText(booking.service)} · <span className="capitalize">{booking.propertyType}</span></div>
        {(booking.address || booking.suburb) && <div className="text-slate-500">{booking.address}{booking.address && booking.suburb ? ', ' : ''}{booking.suburb}</div>}
        {(booking.preferredDate || booking.preferredTime) && <div className="text-slate-500">{booking.preferredDate} {booking.preferredTime}</div>}
        {booking.notes && <div className="text-slate-500 pt-1 border-t border-white/5 mt-1">Customer note: {booking.notes}</div>}
      </div>

      {/* Opens Google Calendar pre-filled. Date and time are left blank on purpose. */}
      <a
        href={gcalUrl(booking)}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-sm font-semibold transition-colors cursor-pointer"
      >
        <CalendarPlus className="w-4 h-4" /> Add to Google Calendar
      </a>

      <div className="space-y-4">
        <Field label="Status">
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value as BookingStatus)}>
            {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </select>
        </Field>

        {(status === 'quoted' || quote !== '') && (
          <Field label="Quote amount (AUD)">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input className="form-input pl-8" inputMode="decimal" placeholder="e.g. 250" value={quote} onChange={e => setQuote(e.target.value)} autoFocus={status === 'quoted'} />
            </div>
          </Field>
        )}

        <Field label="Paid">
          <button
            onClick={() => setPaid(p => !p)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all cursor-pointer ${
              paid
                ? 'bg-emerald-500/10 border-emerald-400/40 hover:bg-emerald-500/15'
                : 'bg-red-500/10 border-red-400/40 hover:bg-red-500/15'
            }`}
          >
            <span className={`font-semibold ${paid ? 'text-emerald-300' : 'text-red-300'}`}>
              {paid ? 'Paid' : 'Not Paid'}
            </span>
            <div
              className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-all flex-shrink-0 ${
                paid
                  ? 'bg-emerald-500 border-emerald-500'
                  : 'border-red-400/60 bg-transparent'
              }`}
            >
              {paid && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
            </div>
          </button>
        </Field>

        <Field label="Private notes (only you see these)">
          <textarea className="form-input resize-none" rows={3} placeholder="Quote details, access info, follow-up reminders…" value={adminNotes} onChange={e => setAdminNotes(e.target.value)} />
        </Field>
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="px-5 py-2.5 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white transition-all cursor-pointer">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2">
          {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Save
        </button>
      </div>
    </Overlay>
  );
}

// ─── Add booking modal (D2D / B2B / phone) ───────────────────────────────

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const selectedServices = f.service ? f.service.split(',') : [];
  const toggleService = (v: string) => setF(p => {
    const list = p.service ? p.service.split(',') : [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    return { ...p, service: next.join(',') };
  });

  const submit = async () => {
    if (!f.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          quoteAmount: f.quoteAmount.trim() === '' ? null : Number(f.quoteAmount.replace(/[^0-9.]/g, '')),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success('Booking added');
      onSaved();
    } catch { toast.error('Could not add booking'); }
    finally { setSaving(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-lg font-bold text-white">Add Booking / Quote</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name *"><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Phone"><input className="form-input" value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="form-input" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Suburb"><input className="form-input" value={f.suburb} onChange={e => set('suburb', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><input className="form-input" value={f.address} onChange={e => set('address', e.target.value)} /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Services (select all that apply)">
            <div className="flex flex-wrap gap-2">
              {SERVICE_OPTIONS.map(o => {
                const active = selectedServices.includes(o.v);
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => toggleService(o.v)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer ${active ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/3 text-slate-300 hover:border-white/20'}`}
                  >
                    {active ? '✓ ' : ''}{o.l}
                  </button>
                );
              })}
            </div>
            {selectedServices.length >= 2 && (
              <p className="text-emerald-400 text-xs mt-2">Multi-service — remember the bundle discount.</p>
            )}
          </Field>
        </div>
        <Field label="Property type">
          <select className="form-input" value={f.propertyType} onChange={e => set('propertyType', e.target.value)}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial (B2B)</option>
          </select>
        </Field>
        <Field label="Preferred date"><input className="form-input" type="date" value={f.preferredDate} onChange={e => set('preferredDate', e.target.value)} /></Field>
        <Field label="Preferred time"><input className="form-input" placeholder="e.g. Morning" value={f.preferredTime} onChange={e => set('preferredTime', e.target.value)} /></Field>
        <Field label="Status">
          <select className="form-input" value={f.status} onChange={e => set('status', e.target.value)}>
            {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </select>
        </Field>
        <Field label="Quote amount (AUD)">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <input className="form-input pl-8" inputMode="decimal" placeholder="optional" value={f.quoteAmount} onChange={e => set('quoteAmount', e.target.value)} />
          </div>
        </Field>
        <div className="sm:col-span-2"><Field label="Private notes"><textarea className="form-input resize-none" rows={2} value={f.adminNotes} onChange={e => set('adminNotes', e.target.value)} /></Field></div>
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="px-5 py-2.5 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white transition-all cursor-pointer">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2">
          {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />} Add Booking
        </button>
      </div>
    </Overlay>
  );
}

// ─── Shared modal shell ──────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg glass border border-white/10 rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl shadow-black/50 max-h-[92svh] overflow-auto"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
