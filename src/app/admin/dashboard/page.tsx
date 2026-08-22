'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, LineChart, Line,
} from 'recharts';
import {
  Calendar, LogOut, TrendingUp,
  Clock, CheckCircle, XCircle, Trash2, ChevronUp,
  ChevronDown, ChevronRight, Search, RefreshCw, DollarSign,
  ArrowUpRight, ArrowDownRight, Edit3, Check, Plus, X, StickyNote, BadgeCheck, Wallet,
  Globe, Eye, Users, Link2, MapPin, Target, CalendarDays, CalendarClock, ArrowRight,
  Repeat, PhoneCall, FileText, Send, CheckSquare, Square, Layers, AlertTriangle,
  Snowflake, Undo2, GripVertical, MoveDown, Timer, ListChecks, Compass, Facebook,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDuration } from '@/lib/analytics';
import toast from 'react-hot-toast';
import type { Booking, BookingStatus, RecurringJob, BookingGroup } from '@/lib/db';
import { type Invoice, type PaymentMethod, PAYMENT_METHOD_LABEL } from '@/lib/invoice';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import { AddressLink } from '@/components/AddressLink';
import { FlagButton, FlagBadge, FlagModal, flagHighlightClass } from '@/components/admin/JobFlag';

// ─── Types ────────────────────────────────────────────────────────────────

interface Stats {
  total: number; thisMonth: number; lastMonth: number;
  uncontacted: number; contacted: number; quoted: number; confirmed: number; completed: number; cancelled: number; cold: number;
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
  leadsBySource: { website: number; manual: number; facebookLeadAd: number };
  revByMonth: { month: string; revenue: number }[];
  topSuburbs: { suburb: string; count: number }[];
  serviceBreakdown: { name: string; value: number }[];
  avgDebtorDays: number | null;
  overdueCount: number;
  overdueValue: number;
}

interface SiteStats {
  allTimeViews: number; views30d: number; today: number; last7: number;
  uniqueVisitors: number; directShare: number;
  byDay: { day: string; views: number }[];
  topPages: {
    path: string; views: number;
    avgScrollPercent: number | null; scrollSamples: number;
    avgTimeOnPageSeconds: number | null; timeSamples: number;
  }[];
  topReferrers: { source: string; views: number }[];
  scrollBuckets: { label: string; count: number }[];
  scrollSampleCount: number;
  avgTimeOnPageSeconds: number | null;
  timeSamples: number;
  avgSessionDurationSeconds: number | null;
  sessionSamples: number;
  bookingFunnel: { step: string; label: string; count: number }[];
  bookingFunnelStarted: number;
}


// ─── Constants ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: React.FC<{ className?: string; style?: React.CSSProperties }> }> = {
  uncontacted: { label: 'Uncontacted', color: '#F59E0B', icon: Clock },
  contacted:   { label: 'Contacted',   color: '#2DD4BF', icon: PhoneCall },
  quoted:      { label: 'Quoted',      color: '#A78BFA', icon: DollarSign },
  confirmed:   { label: 'Confirmed',   color: '#38BDF8', icon: CheckCircle },
  completed:   { label: 'Completed',   color: '#34D399', icon: Check },
  cancelled:   { label: 'Cancelled',   color: '#F87171', icon: XCircle },
  cold:        { label: 'Cold Lead',   color: '#94A3B8', icon: Snowflake },
};
const STATUS_KEYS = Object.keys(STATUS_CONFIG) as BookingStatus[];
// Everything except "cold" — the Bookings tab's main list only ever shows
// these; cold leads live in their own collapsible section further down.
const ACTIVE_STATUS_KEYS = STATUS_KEYS.filter(s => s !== 'cold');
// Leads/Pipeline sub-tabs (Bookings tab): "has this job ever been quoted?"
// splits the statuses cleanly in two. Cold rides along with Leads — a cold
// lead is still fundamentally a lead, just a stale one.
const LEADS_STATUSES: BookingStatus[] = ['uncontacted', 'contacted', 'cold'];
const PIPELINE_STATUSES: BookingStatus[] = ['quoted', 'confirmed', 'completed', 'cancelled'];

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
    .join(' + ') || '-';

// Internal calendar slot label. "Tuesday 3:00 PM" within a week, else "15 Aug 2026".
function scheduledLabel(iso: string): string {
  const d = new Date(iso);
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = (day0(d) - day0(new Date())) / 86400000;
  if (diffDays >= 0 && diffDays < 7) {
    return `${d.toLocaleDateString('en-AU', { weekday: 'long' })} ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
// "Today" / "3d ago" / "2mo ago" — sub-line under the Date Added column.
function daysAgoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const emptyForm = {
  name: '', phone: '', email: '', service: 'window-washing', propertyType: 'residential',
  suburb: '', address: '', preferredDate: '', preferredTime: '', status: 'uncontacted',
  quoteAmount: '', notes: '', adminNotes: '', leadSource: '',
};

// "How did we get this job?" — manual-add attribution.
const LEAD_SOURCE_OPTIONS: { v: string; l: string }[] = [
  { v: 'called-us', l: 'Called us' },
  { v: 'we-called', l: 'We called them' },
  { v: 'door-to-door', l: 'Door to door' },
  { v: 'in-person', l: 'In person' },
  { v: 'real-estate', l: 'Real estate agent' },
  { v: 'other', l: 'Other' },
];

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

// Generic checkbox-list filter dropdown — replaces the old single-value
// <select> for Status/Service so more than one can be picked at once.
// Empty `selected` means "all" (no filter applied) — and displays every box
// as checked, so the default view reads as "everything's shown" instead of
// looking like nothing's selected. Unchecking one converts to an explicit
// list of the rest; re-checking everything collapses back to `[]`. If the
// user unchecks the very last box, that's "show nothing" — a real, different
// state from the default "show everything", so it's held as the one-element
// NONE_SENTINEL array rather than an empty array (which would otherwise be
// indistinguishable from — and silently revert to — the "all" default).
const NONE_SENTINEL = '__none__';
function MultiSelectDropdown({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const isNone = selected.length === 1 && selected[0] === NONE_SENTINEL;
  const toggle = (v: string) => {
    const allValues = options.map(o => o.value);
    const effective = selected.length === 0 ? allValues : isNone ? [] : selected;
    const next = effective.includes(v) ? effective.filter(x => x !== v) : [...effective, v];
    if (next.length === 0) onChange([NONE_SENTINEL]);
    else if (next.length === allValues.length) onChange([]);
    else onChange(next);
  };
  const text = selected.length === 0 ? `All ${label}`
    : isNone ? `No ${label}`
    : selected.length === 1 ? (options.find(o => o.value === selected[0])?.label ?? label)
    : `${selected.length} ${label}`;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(v => !v)} className="form-input py-2.5 text-sm w-full sm:w-auto flex items-center justify-between gap-2 cursor-pointer">
        <span className="truncate">{text}</span>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-navy-800 shadow-xl p-1.5">
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-sky-400 hover:bg-white/5 cursor-pointer">Select all</button>
          )}
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-white/5 cursor-pointer text-sm text-slate-200">
              <input
                type="checkbox"
                checked={selected.length === 0 ? true : isNone ? false : selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="appearance-none w-3.5 h-3.5 rounded border border-white/25 bg-white/10 checked:bg-sky-500 checked:border-sky-500 cursor-pointer relative before:content-['✓'] before:absolute before:inset-0 before:flex before:items-center before:justify-center before:text-[9px] before:leading-none before:text-white before:opacity-0 checked:before:opacity-100"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
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

// ─── Upcoming jobs (internal calendar — bookings with a scheduled slot) ──────

function UpcomingJobs({ bookings }: { bookings: Booking[] }) {
  const now = Date.now();
  const upcoming = bookings
    .filter(b => b.scheduledAt && new Date(b.scheduledAt).getTime() >= now && b.status !== 'completed' && b.status !== 'cancelled')
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .slice(0, 8);
  return (
    <div className="glass rounded-2xl border border-white/8 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-white flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-sky-400" /> Upcoming jobs
        </h3>
        <Link href="/admin/calendar" className="text-sky-400 hover:text-sky-300 text-xs font-semibold inline-flex items-center gap-1">Calendar <ArrowRight className="w-3.5 h-3.5" /></Link>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-slate-500 text-sm">No jobs scheduled yet. Confirm a booking to add it to the calendar.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {upcoming.map(b => {
            const d = new Date(b.scheduledAt as string);
            return (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-shrink-0 w-11 text-center">
                  <div className="text-sky-400 text-[10px] font-semibold uppercase leading-none">{d.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
                  <div className="text-white font-bold text-lg leading-tight">{d.getDate()}</div>
                  <div className="text-slate-500 text-[10px] leading-none">{d.toLocaleDateString('en-AU', { month: 'short' })}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium truncate">{b.name}</div>
                  <div className="text-slate-500 text-xs truncate">
                    {d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}{(b.address || b.suburb) ? ` · ${[b.address, b.suburb].filter(Boolean).join(', ')}` : ''}
                  </div>
                </div>
                <Link
                  href={`/admin/bookings/${b.id}?from=${encodeURIComponent('/admin/dashboard?tab=overview')}`}
                  title={`Open booking: ${b.name}`}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sky-400 bg-sky-400/10 hover:bg-sky-400/20 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Booking <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Guest assignment ────────────────────────────────────────────────────

export type GuestProfile = { id: string; name: string; active: boolean; createdAt: string };

// Shows at a glance whether a job has been sent to a subcontractor. Unassigned
// is the default, unmarked state — no tag at all, so the badge only ever
// draws attention when a job actually has been sent somewhere.
function AssignBadge({ guestId, name }: { guestId?: string | null; name: string }) {
  if (!guestId) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-400/15 text-sky-300 border border-sky-400/25" title={`Sent to ${name}`}>
      <Send className="w-2.5 h-2.5" /> {name}
    </span>
  );
}

// Customer claimed "I've paid" on the invoice, but it's not confirmed here yet —
// the discontinuity between what the customer said and what's actually reconciled.
function CustomerPaidClaimBadge({ booking }: { booking: Booking }) {
  if (booking.paid || !booking.customerMarkedPaidAt) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-400/15 text-amber-300 border border-amber-400/25"
      title={`Customer marked as paid ${new Date(booking.customerMarkedPaidAt).toLocaleDateString('en-AU')}, not yet confirmed`}
    >
      <AlertTriangle className="w-2.5 h-2.5" /> Customer says paid
    </span>
  );
}

// A row in either the main list or the select-mode drag list: either a lone
// booking, or a whole group collapsed into one entry.
type ListItem = { kind: 'booking'; booking: Booking } | { kind: 'group'; group: BookingGroup; members: Booking[] };

// Shared per-booking action handlers, threaded down to the row/card renderers
// so the same markup works whether a booking is shown loose in the list or
// nested inside an expanded group.
type BookingRowActions = {
  guestName: (id?: string | null) => string;
  onOpen: (id: string) => void;
  onInlineStatus: (b: Booking, val: BookingStatus) => void;
  onTogglePaid: (b: Booking) => void;
  onManage: (b: Booking) => void;
  onRemove: (id: string) => void;
  onFlag: (b: Booking) => void;
};

// One booking, mobile-card layout (phone-first list + inside expanded groups).
function BookingCard({ b, actions }: { b: Booking; actions: BookingRowActions }) {
  const { guestName, onOpen, onInlineStatus, onTogglePaid, onManage, onRemove, onFlag } = actions;
  return (
    <div
      onClick={() => onOpen(b.id)}
      className={`glass rounded-2xl border p-4 cursor-pointer hover:border-white/20 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors ${flagHighlightClass(b) || 'border-white/8'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-white font-semibold flex items-center gap-2 flex-wrap">
            {b.name}
            {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
            {b.source === 'facebook-lead-ad' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 border border-sky-400/20 inline-flex items-center gap-1"><Facebook className="w-2.5 h-2.5" />FB Lead</span>}
            <AssignBadge guestId={b.assignedGuestId} name={guestName(b.assignedGuestId)} />
            <CustomerPaidClaimBadge booking={b} />
            <FlagBadge booking={b} />
          </div>
          <a href={`tel:${b.phone}`} onClick={e => e.stopPropagation()} className="text-sky-400 text-sm cursor-pointer">{b.phone}</a>
          <div className="text-slate-500 text-xs mt-0.5">{serviceText(b.service)}{b.propertyType === 'commercial' ? ' · Commercial' : ''}</div>
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
      {/* Controls strip — dead zone: stopPropagation so taps here (and in the
          gaps between buttons) never open the booking, only the buttons act. */}
      <div className="mt-4 pt-3 border-t border-white/5 space-y-2.5" onClick={e => e.stopPropagation()}>
        <select
          value={b.status}
          onChange={e => onInlineStatus(b, e.target.value as BookingStatus)}
          className={`w-full text-sm font-semibold rounded-lg px-3 py-2.5 cursor-pointer bg-transparent border focus:outline-none badge-${b.status}`}
        >
          {STATUS_KEYS.map(s => <option key={s} value={s} className="bg-navy-800 text-white">{STATUS_CONFIG[s].label}</option>)}
        </select>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onTogglePaid(b)}
            title={b.paid ? 'Mark unpaid' : 'Mark paid'}
            className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-all cursor-pointer ${b.paid ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-red-500/15 border-red-400/40 text-red-300'}`}
          >
            {b.paid ? '✓ Paid' : 'Not Paid'}
          </button>
          <button onClick={() => onManage(b)} className="p-2.5 rounded-lg glass border border-white/10 text-sky-400 cursor-pointer" title="Manage / notes / quote">
            <Edit3 className="w-4 h-4" />
          </button>
          <Link href={`/admin/calendar?schedule=${b.id}`} className={`p-2.5 rounded-lg glass border border-white/10 cursor-pointer ${b.scheduledAt ? 'text-emerald-300' : 'text-sky-300'}`} title={b.scheduledAt ? `Scheduled: ${scheduledLabel(b.scheduledAt)}` : 'Add to calendar'}>
            <CalendarClock className="w-4 h-4" />
          </Link>
          <FlagButton booking={b} onClick={() => onFlag(b)} />
          <button onClick={() => onRemove(b.id)} className="p-2.5 rounded-lg glass border border-white/10 text-red-400 cursor-pointer" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// One booking, desktop-table row layout.
function BookingRow({ b, actions }: { b: Booking; actions: BookingRowActions }) {
  const { guestName, onOpen, onInlineStatus, onTogglePaid, onManage, onRemove, onFlag } = actions;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => onOpen(b.id)} className={`group grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_3rem_auto] gap-4 px-6 py-4 border-b hover:bg-white/[0.04] transition-colors items-center cursor-pointer ${flagHighlightClass(b) || 'border-white/5'}`}>
      {/* Customer — whole row opens the booking */}
      <div className="min-w-0">
        <div className="text-white group-hover:text-sky-400 transition-colors text-sm font-medium flex items-center gap-2 flex-wrap">
          {b.name}
          {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
          {b.source === 'facebook-lead-ad' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 border border-sky-400/20 inline-flex items-center gap-1"><Facebook className="w-2.5 h-2.5" />FB Lead</span>}
          <AssignBadge guestId={b.assignedGuestId} name={guestName(b.assignedGuestId)} />
          <CustomerPaidClaimBadge booking={b} />
          <FlagBadge booking={b} />
        </div>
        <div className="text-slate-500 text-xs">{b.phone}</div>
        <div className="text-slate-600 text-xs truncate">{b.suburb}{b.address ? ` · ${b.address}` : ''}</div>
      </div>
      {/* Service */}
      <div>
        <div className="text-slate-300 text-sm">{serviceText(b.service)}</div>
        {b.propertyType === 'commercial' && <div className="text-slate-600 text-xs">Commercial</div>}
      </div>
      {/* Date added — the chronological order the list defaults to */}
      <div>
        <div className="text-slate-300 text-sm">{new Date(b.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div className="text-slate-600 text-xs">{daysAgoLabel(b.createdAt)}</div>
      </div>
      {/* Status — stopPropagation keeps the row-open off this control */}
      <div onClick={e => e.stopPropagation()}>
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
          : <span className="text-slate-600">-</span>}
        {b.adminNotes ? <StickyNote className="inline w-3 h-3 ml-1.5 text-slate-500" /> : null}
      </div>
      {/* Paid — stopPropagation dead zone */}
      <div onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onTogglePaid(b)}
          title={b.paid ? 'Mark unpaid' : 'Mark paid'}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${b.paid ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300' : 'bg-red-500/15 border border-red-400/40 text-red-300 hover:bg-red-500/20'}`}
        >
          {b.paid ? '✓ Paid' : 'Not Paid'}
        </button>
      </div>
      {/* Actions — dead-zone wrapper (with left padding buffer) so stray
          clicks near the icons never open the row */}
      <div className="flex gap-2 pl-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => onManage(b)} className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-400/10 transition-all cursor-pointer" title="Manage / notes / quote">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <Link href={`/admin/calendar?schedule=${b.id}`} className={`p-1.5 rounded-lg hover:bg-sky-400/10 transition-all cursor-pointer ${b.scheduledAt ? 'text-emerald-300' : 'text-slate-500 hover:text-sky-300'}`} title={b.scheduledAt ? `Scheduled: ${scheduledLabel(b.scheduledAt)}` : 'Add to calendar'}>
          <CalendarClock className="w-3.5 h-3.5" />
        </Link>
        <FlagButton booking={b} onClick={() => onFlag(b)} size="sm" />
        <button onClick={() => onRemove(b.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all cursor-pointer" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// A group collapsed to one row (title · count · total) sitting inline with
// everything else in the list — expands to show its member bookings using the
// same card/row markup.
function GroupBlock({ group, members, open, onToggle, onDelete, actions }: {
  group: BookingGroup; members: Booking[]; open: boolean; onToggle: () => void; onDelete: () => void; actions: BookingRowActions;
}) {
  return (
    <div className="glass rounded-xl border border-white/10 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-3 text-left cursor-pointer">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Layers className="w-4 h-4 text-sky-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-white text-sm font-semibold truncate">{group.title}</div>
            <div className="text-slate-500 text-xs">{group.jobCount} job{group.jobCount !== 1 ? 's' : ''} · {money(group.totalValue)}</div>
          </div>
        </div>
        <span onClick={e => { e.stopPropagation(); onDelete(); }} className="p-2 rounded-lg text-slate-500 hover:text-red-400 cursor-pointer flex-shrink-0" title="Delete group">
          <Trash2 className="w-4 h-4" />
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 p-3 space-y-2 bg-black/10">
          <div className="lg:hidden space-y-2">
            {members.map(b => <BookingCard key={b.id} b={b} actions={actions} />)}
          </div>
          <div className="hidden lg:block rounded-lg overflow-hidden border border-white/5">
            {members.map(b => <BookingRow key={b.id} b={b} actions={actions} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsed section for "cold" leads — kept out of the main active-jobs list
// so it doesn't clutter day-to-day work, but still reachable in one click.
// Sits below the main list rather than mixed into it.
function ColdLeadsSection({ bookings, open, onToggle, onOpen, onRevive }: {
  bookings: Booking[]; open: boolean; onToggle: () => void; onOpen: (id: string) => void; onRevive: (b: Booking) => void;
}) {
  if (bookings.length === 0) return null;
  return (
    <div className="glass rounded-2xl border border-white/8 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-4 text-left cursor-pointer">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Snowflake className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <span className="text-white text-sm font-semibold">Cold Leads</span>
          <span className="text-slate-500 text-xs">{bookings.length} job{bookings.length !== 1 ? 's' : ''}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-white/10 p-3 space-y-2 bg-black/10">
          {bookings.map(b => (
            <div key={b.id} className="glass rounded-xl border border-white/8 p-3 flex items-center gap-3">
              <button onClick={() => onOpen(b.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                <div className="text-white text-sm font-medium truncate flex items-center gap-2 flex-wrap">
                  {b.name}
                  {b.autoMoved && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-400/15 text-slate-300 border border-slate-400/20" title="Moved here automatically, not by a person">Auto</span>
                  )}
                </div>
                <div className="text-slate-500 text-xs truncate">
                  {serviceText(b.service)}
                  {b.autoMoved && b.autoMovedAt ? ` · Auto-moved ${new Date(b.autoMovedAt).toLocaleDateString('en-AU')}` : ''}
                </div>
              </button>
              <button
                onClick={() => onRevive(b)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-xs font-semibold cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" /> Move to active
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Select-mode list (bulk select + drag-to-reorder) ────────────────────
//
// Deliberately its own component: all the drag gesture state (dragKey,
// dropBeforeKey, fadingKey) lives HERE, not in the Dashboard page. A fast-moving
// pointer can update dropBeforeKey dozens of times a second — if that state
// lived in Dashboard, every one of those updates would re-render the entire
// page (stat cards, charts, every tab's data). Colocating it here means a
// drag only ever re-renders this list.
//
// Pointer Events, not HTML5 native drag — that API barely works on
// touch/iPhone, which is where this PWA mostly lives. Grouped bookings drag
// as a single unit, keyed by the group's id; a lone booking is keyed by its
// own id (dragKeyOf). Row positions are measured ONCE at drag-start
// (dragRectsRef) and the move handler is pure arithmetic against those
// cached numbers — no DOM queries while actually dragging, which is what
// keeps it smooth and immune to the "dead zone" elementFromPoint had
// crossing back over a row's own starting slot.
function SelectModeList({ items, selected, onToggleSel, onToggleGroupSel, onReorder }: {
  items: ListItem[];
  selected: Set<string>;
  onToggleSel: (id: string) => void;
  onToggleGroupSel: (members: Booking[]) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  // Key of the row that just landed from a drop — stays set for 2s purely to
  // switch that row's color transition to a slow duration, so the green
  // highlight visibly fades out instead of vanishing the instant it's dropped.
  const [fadingKey, setFadingKey] = useState<string | null>(null);
  // Which item the dragged one would land BEFORE if dropped right now — null
  // means "at the very end". Working in keys (not a raw index into the
  // still-includes-the-dragged-item array) is what fixes the down-only bug
  // below: an index has to be adjusted for "the dragged item is about to be
  // removed," and that adjustment was silently a no-op for the very next row
  // when moving down. A key naming "whichever item comes after the drop
  // point" needs no such adjustment — it's correct however far you move.
  const [dropBeforeKey, setDropBeforeKey] = useState<string | null>(null);
  const dropBeforeKeyRef = useRef<string | null>(null);
  const updateDropBeforeKey = (key: string | null) => { dropBeforeKeyRef.current = key; setDropBeforeKey(key); };
  const dragRowElRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef(0);
  // Positions of every OTHER row, captured once at drag-start — deliberately
  // excludes the dragged row itself, so this is already "post-removal"
  // space and the drop math never needs an index adjustment at all.
  const dragRectsRef = useRef<{ key: string; top: number; bottom: number }[]>([]);
  const dragRowRegistryRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // A plain `ref={el => ...}` gets a brand-new function every render, which
  // makes React null-out then reassign the DOM ref on every re-render — one
  // more thing that can (rarely) race with a fast pointer mid-drag. Caching
  // one stable callback per key removes that risk outright.
  const refCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const getRowRef = (key: string) => {
    let fn = refCallbacks.current.get(key);
    if (!fn) {
      fn = el => { if (el) dragRowRegistryRef.current.set(key, el); else dragRowRegistryRef.current.delete(key); };
      refCallbacks.current.set(key, fn);
    }
    return fn;
  };
  // The color-bearing inner <div> of each row, registered separately from the
  // outer motion.div above — this is what the drop-fade animates directly.
  const colorRowRegistryRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const colorRefCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const getColorRowRef = (key: string) => {
    let fn = colorRefCallbacks.current.get(key);
    if (!fn) {
      fn = el => { if (el) colorRowRegistryRef.current.set(key, el); else colorRowRegistryRef.current.delete(key); };
      colorRefCallbacks.current.set(key, fn);
    }
    return fn;
  };
  // The drop fade is driven directly through the Web Animations API instead
  // of a Tailwind transition class. A CSS transition only fires when the
  // browser paints the "before" value on its own before the "after" value is
  // applied — and that depends on exactly how the drop's DOM reorder, the
  // framer-motion layout pass, and the React commit interleave, which turned
  // out to differ by drag direction (reliable moving up, not moving down).
  // Commanding the two colors explicitly here sidesteps that entirely: the
  // animation doesn't care what else moves around it.
  const fadeAnimRef = useRef<Map<string, Animation>>(new Map());
  const runDropFade = (key: string, on: boolean) => {
    const el = colorRowRegistryRef.current.get(key);
    if (!el) return;
    fadeAnimRef.current.get(key)?.cancel();
    const anim = el.animate(
      [
        { borderColor: 'rgb(52, 211, 153)', backgroundColor: 'rgba(52, 211, 153, 0.15)' },
        on
          ? { borderColor: 'rgb(56, 189, 248)', backgroundColor: 'rgba(56, 189, 248, 0.1)' }
          : { borderColor: 'rgba(255, 255, 255, 0.1)', backgroundColor: 'rgba(255, 255, 255, 0)' },
      ],
      { duration: 2000, easing: 'ease', fill: 'forwards' },
    );
    fadeAnimRef.current.set(key, anim);
  };

  const dragKeyOf = (item: ListItem) => item.kind === 'group' ? item.group.id : item.booking.id;

  const startDrag = (key: string, e: React.PointerEvent) => {
    e.preventDefault();
    // Re-grabbing a row before its previous drop-fade finished would
    // otherwise leave that animation's held color fighting the instant-green
    // class change below.
    fadeAnimRef.current.get(key)?.cancel();
    fadeAnimRef.current.delete(key);
    dragStartYRef.current = e.clientY;
    const rects = Array.from(dragRowRegistryRef.current.entries())
      .filter(([k]) => k !== key)
      .map(([k, el]) => { const r = el.getBoundingClientRect(); return { key: k, top: r.top, bottom: r.bottom }; })
      .sort((a, b) => a.top - b.top);
    dragRectsRef.current = rects;
    dragRowElRef.current = dragRowRegistryRef.current.get(key) ?? null;
    // Starting position: whichever item currently follows this one (or the
    // very end, if it's already last) — i.e. "no move yet".
    const keys = items.map(dragKeyOf);
    const myIdx = keys.indexOf(key);
    updateDropBeforeKey(myIdx >= 0 && myIdx < keys.length - 1 ? keys[myIdx + 1] : null);
    setDragKey(key);
  };

  // Pointer tracking for the currently-dragged row, active only while `dragKey` is set.
  useEffect(() => {
    if (!dragKey) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      // Imperative DOM mutation, not React state — the "follow the finger"
      // motion never triggers a re-render.
      if (dragRowElRef.current) dragRowElRef.current.style.transform = `translateY(${e.clientY - dragStartYRef.current}px)`;
      const rects = dragRectsRef.current;
      let targetKey: string | null = null;
      for (let i = 0; i < rects.length; i++) {
        if (e.clientY < (rects[i].top + rects[i].bottom) / 2) { targetKey = rects[i].key; break; }
      }
      if (targetKey !== dropBeforeKeyRef.current) updateDropBeforeKey(targetKey);
    };
    const onUp = () => {
      if (dragRowElRef.current) { dragRowElRef.current.style.transform = ''; dragRowElRef.current = null; }
      const targetKey = dropBeforeKeyRef.current;
      const draggedItem = items.find(it => dragKeyOf(it) === dragKey);
      if (draggedItem) {
        const filtered = items.filter(it => dragKeyOf(it) !== dragKey);
        const insertAt = targetKey === null ? filtered.length : Math.max(0, filtered.findIndex(it => dragKeyOf(it) === targetKey));
        const reordered = [...filtered];
        reordered.splice(insertAt, 0, draggedItem);
        if (reordered.map(dragKeyOf).join() !== items.map(dragKeyOf).join()) {
          onReorder(reordered.flatMap(item => item.kind === 'group' ? item.members.map(m => m.id) : [item.booking.id]));
        }
        const draggedOn = draggedItem.kind === 'group'
          ? draggedItem.members.length > 0 && draggedItem.members.every(m => selected.has(m.id))
          : selected.has(draggedItem.booking.id);
        runDropFade(dragKey, draggedOn);
      }
      setFadingKey(dragKey);
      setTimeout(() => setFadingKey(k => k === dragKey ? null : k), 2000);
      setDragKey(null);
      updateDropBeforeKey(null);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey]);

  return (
    <>
      {items.map((item) => {
        const key = dragKeyOf(item);
        const isGroup = item.kind === 'group';
        const on = isGroup ? item.members.length > 0 && item.members.every(m => selected.has(m.id)) : selected.has(item.booking.id);
        const isDragging = dragKey === key;
        const isFading = fadingKey === key;
        return (
          <div key={key}>
            {/* Green insertion line — sits between the two rows/groups the
                held item will land between, tracks dropBeforeKey live while dragging. */}
            {dragKey && dropBeforeKey === key && (
              <div className="h-0.5 my-1 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            )}
            <motion.div
              // Only animated when nothing is actively being dragged AND nothing
              // is mid-fade. It's off for the whole fade window (not just during
              // the drag itself) because framer-motion's own FLIP transform on
              // this element was still fighting the plain CSS color transition on
              // the row below it — even split onto separate nodes — and only on
              // rows moving to a later DOM position. Rather than chase that, the
              // FLIP snap is simply skipped for a row that's fading out: the
              // pointer-follow transform during drag already got it visually to
              // the right spot, so no animation is lost, and the color fade never
              // has a transform animation running alongside it to interfere with.
              layout={!dragKey && !isFading}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              ref={getRowRef(key)}
              style={isDragging ? { position: 'relative', zIndex: 50, pointerEvents: 'none' } : undefined}
            >
              <div
                ref={getColorRowRef(key)}
                style={isDragging ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } : undefined}
                // The 2s fade after a drop is driven imperatively via
                // runDropFade (Web Animations API), not this transition — it
                // visually overrides these classes while it runs regardless
                // of what duration is set here. This is just the instant
                // on-grab green (duration-0) and the normal 150ms hover/select
                // color change.
                className={`w-full flex items-center gap-2 p-3 rounded-xl border transition-colors ${isDragging ? 'duration-0' : 'duration-150'} ${isDragging ? 'border-emerald-400 bg-emerald-400/15' : on ? 'border-sky-400 bg-sky-400/10' : 'border-white/10 glass hover:border-white/20'}`}
              >
                {/* Drag only starts from this handle — no negative-margin hit-area
                    trick (that let this handle's expanded touch target overlap the
                    select button next to it, so some taps hit the wrong one) — just
                    generous real padding. touchAction:'none' stops the browser's
                    own scroll gesture from starting here. */}
                <span
                  onPointerDown={e => startDrag(key, e)}
                  style={{ touchAction: 'none' }}
                  className="p-3 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                >
                  <GripVertical className="w-4 h-4 text-slate-600" />
                </span>
                {isGroup ? (
                  <button onClick={() => onToggleGroupSel(item.members)} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                    {on ? <CheckSquare className="w-5 h-5 text-sky-400 flex-shrink-0" /> : <Square className="w-5 h-5 text-slate-500 flex-shrink-0" />}
                    <Layers className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate flex items-center gap-1.5">
                        {item.group.title}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 border border-sky-400/20 flex-shrink-0">Group</span>
                      </div>
                      <div className="text-slate-500 text-xs truncate">{item.group.jobCount} job{item.group.jobCount !== 1 ? 's' : ''} · {money(item.group.totalValue)}</div>
                    </div>
                  </button>
                ) : (
                  <button onClick={() => onToggleSel(item.booking.id)} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                    {on ? <CheckSquare className="w-5 h-5 text-sky-400 flex-shrink-0" /> : <Square className="w-5 h-5 text-slate-500 flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">{item.booking.name}</div>
                      <div className="text-slate-500 text-xs truncate">{serviceText(item.booking.service)} · {STATUS_CONFIG[item.booking.status]?.label ?? item.booking.status}{typeof item.booking.quoteAmount === 'number' && item.booking.quoteAmount > 0 ? ` · ${money(item.booking.quoteAmount)}` : ''}</div>
                    </div>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        );
      })}
      {dragKey && dropBeforeKey === null && (
        <div className="h-0.5 my-1 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
      )}
    </>
  );
}

// ─── Bottom tab bar (mobile / installed app) ─────────────────────────────

type TabKey = 'overview' | 'bookings' | 'business' | 'site';

// ─── Main Dashboard ─────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'business' | 'site'>('overview');
  const moreSheet = useMoreSheet();

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

  // Guest logins — used for the "sent to" badges and the view-as selector.
  const [guests, setGuests] = useState<GuestProfile[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/guests');
        if (res.ok) setGuests(await res.json());
      } catch { /* selector just stays empty */ }
    })();
  }, []);
  const guestName = (id?: string | null) => guests.find(g => g.id === id)?.name ?? 'guest';

  // Which bookings already have an invoice linked — powers the "no invoice
  // yet" indicator on the Done-but-not-paid list, and lets "mark paid" offer
  // to settle the linked invoice (with a payment method) in the same step.
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invoices');
      if (res.ok) setInvoices(await res.json());
    } catch { /* indicator just won't show */ }
  }, []);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  const invoicedBookingIds = new Set(invoices.flatMap(i => i.bookingIds ?? []));
  // First unpaid invoice linked to a booking — that's the one "mark paid" should settle.
  const unpaidInvoiceFor = (bookingId: string) => invoices.find(i => (i.bookingIds ?? []).includes(bookingId) && i.status !== 'paid') ?? null;

  // Switch into a guest's dashboard. No password — the admin session is kept,
  // so the "Admin" button over there brings you straight back.
  const viewAsGuest = async (guestId: string) => {
    const res = await fetch('/api/admin/switch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId }),
    });
    if (res.ok) router.push('/guest');
    else toast.error('Could not switch');
  };

  // Filters — multi-select checkboxes now, so these are arrays. Empty = "all".
  // 'facebook-lead-ad' is a synthetic status option that actually filters by
  // source, not status — see fetchData/API below.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  // Bookings tab splits into two sub-tabs: Leads (not yet quoted — including
  // Cold) and Pipeline (quoted onward). Purely a client-side filter over the
  // already-fetched `bookings` — see viewBookings below — so it can't starve
  // Overview's widgets (they read the same shared, unscoped fetch).
  const [bookingsView, setBookingsView] = useState<'leads' | 'pipeline'>('leads');
  const switchBookingsView = (v: 'leads' | 'pipeline') => { setBookingsView(v); setStatusFilter([]); };
  const [showPaid, setShowPaid] = useState(true);
  // Default to the manual drag order, not createdAt — a booking's sortOrder
  // is null until someone drags it, and the API's sortOrder sort already
  // falls unset ones to the bottom in their normal createdAt-desc order (see
  // /api/admin/bookings), so this looks identical to before until a drag
  // actually happens, and then it's the one that survives a refresh instead
  // of always snapping back to chronological.
  const [sortField, setSortField] = useState('sortOrder');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modals
  const [manage, setManage] = useState<Booking | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [flagTarget, setFlagTarget] = useState<Booking | null>(null);

  // Bulk select + grouping
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<BookingGroup[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [delGroup, setDelGroup] = useState<BookingGroup | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroupExpanded = (id: string) => setExpandedGroups(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Cold-leads collapsible section + "move back to active" modal
  const [coldOpen, setColdOpen] = useState(false);
  const [revive, setRevive] = useState<Booking | null>(null);
  const [reviveStatus, setReviveStatus] = useState<BookingStatus>('uncontacted');
  const openRevive = (b: Booking) => { setRevive(b); setReviveStatus('uncontacted'); };

  // Jobs the 14-day stale-lead check JUST auto-moved to Cold Lead this load —
  // shown as a one-time "moved to Cold Lead" popup with Undo.
  const [staleMoved, setStaleMoved] = useState<Booking[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/bookings/stale-check');
        if (!res.ok) return;
        const moved: Booking[] = await res.json();
        if (moved.length > 0) { setStaleMoved(moved); fetchData(); }
      } catch { /* best-effort, no popup if it fails */ }
    })();
    // Runs once per dashboard load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => { setSelected(new Set()); setSelectMode(false); };

  const loadGroups = useCallback(async () => {
    try { const r = await fetch('/api/admin/groups'); if (r.ok) setGroups(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const bulkAction = async (body: Record<string, unknown>, msg: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/admin/bookings/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ids: [...selected] }),
      });
      if (!res.ok) throw new Error();
      toast.success(msg);
      clearSel();
      await fetchData();
      await loadGroups();
    } catch { toast.error('Bulk action failed'); }
    finally { setBulkBusy(false); }
  };

  const createGroup = async (title: string) => {
    setBulkBusy(true);
    try {
      const res = await fetch('/api/admin/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, bookingIds: [...selected] }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Group "${title}" created`);
      setShowGroupModal(false); clearSel();
      await Promise.all([fetchData(), loadGroups()]);
    } catch { toast.error('Could not create group'); }
    finally { setBulkBusy(false); }
  };

  const removeGroup = async (g: BookingGroup, withBookings: boolean) => {
    try {
      const res = await fetch(`/api/admin/groups/${g.id}${withBookings ? '?withBookings=true' : ''}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(withBookings ? 'Group and its bookings deleted' : 'Group deleted (bookings kept)');
      setDelGroup(null);
      await Promise.all([fetchData(), loadGroups()]);
    } catch { toast.error('Delete failed'); }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, bRes] = await Promise.all([
        fetch('/api/admin/bookings?type=stats'),
        fetch(`/api/admin/bookings?status=${statusFilter.join(',') || 'all'}&service=${serviceFilter.join(',') || 'all'}&sort=${sortField}&order=${sortOrder}&search=${encodeURIComponent(search)}`),
      ]);
      if (sRes.status === 401 || bRes.status === 401) { router.push('/admin'); return; }
      setStats(await sRes.json());
      setBookings(await bRes.json());
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [statusFilter, serviceFilter, sortField, sortOrder, search, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Facebook lead sync: pulls in anything new from the Google Sheet (see
  // /api/cron/meta-leads-sheet), then reloads bookings. Dedup means existing
  // rows are never touched and a booking deleted from the CRM stays deleted
  // (see dismissLeadId in src/lib/db.ts) — this only ever adds genuinely new
  // leads. Runs on the manual refresh button and every 60s while the
  // Bookings tab is open.
  const [fbSyncing, setFbSyncing] = useState(false);
  const syncFacebookLeadsAndRefresh = useCallback(async () => {
    setFbSyncing(true);
    try {
      const res = await fetch('/api/cron/meta-leads-sheet');
      if (res.ok) {
        const data = await res.json();
        if (data.imported > 0) toast.success(`${data.imported} new Facebook lead${data.imported !== 1 ? 's' : ''} imported`);
      }
    } catch { /* best-effort — bookings still refresh below */ }
    finally { setFbSyncing(false); }
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (activeTab !== 'bookings') return;
    const id = setInterval(() => { syncFacebookLeadsAndRefresh(); }, 60_000);
    return () => clearInterval(id);
  }, [activeTab, syncFacebookLeadsAndRefresh]);

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

  // Marking a job paid when it has a linked (not-yet-paid) invoice settles
  // the invoice instead of the booking directly — the invoice's own paid-sync
  // (syncInvoicePaidToBookings in db.ts) then flips the booking's `paid` too,
  // so the two never end up disagreeing about a job with an invoice.
  const [payInvoicePrompt, setPayInvoicePrompt] = useState<{ booking: Booking; invoice: Invoice } | null>(null);
  const onTogglePaid = (b: Booking) => {
    if (!b.paid) {
      const inv = unpaidInvoiceFor(b.id);
      if (inv) { setPayInvoicePrompt({ booking: b, invoice: inv }); return; }
    }
    saveBooking(b.id, { paid: !b.paid });
  };
  const confirmPayInvoice = async (method: PaymentMethod) => {
    if (!payInvoicePrompt) return;
    try {
      const res = await fetch(`/api/admin/invoices/${payInvoicePrompt.invoice.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', paymentMethod: method }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Marked paid: ${PAYMENT_METHOD_LABEL[method].toLowerCase()}`);
      setPayInvoicePrompt(null);
      await Promise.all([fetchData(), loadInvoices()]);
    } catch { toast.error('Could not mark paid'); }
  };

  // Website lead followed up — flips it from "Uncontacted" to "Contacted",
  // which drops it out of "Leads to call back" (contactedAt auto-stamps
  // server-side, same pattern as completedAt — see withContactedAt in db.ts).
  const markContacted = (b: Booking) => saveBooking(b.id, { status: 'contacted' });

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

  const flagSave = async (b: Booking, note: string) => {
    await saveBooking(b.id, { flagNote: note, flaggedAt: b.flaggedAt ?? new Date().toISOString() });
    setFlagTarget(null);
  };
  const flagClear = async (b: Booking) => {
    await saveBooking(b.id, { flagNote: null, flaggedAt: null });
    setFlagTarget(null);
  };

  const removeBooking = async (id: string) => {
    const target = bookings.find(x => x.id === id);
    if (!confirm(`Delete the booking for ${target?.name ?? 'this customer'}? It's kept in Settings -> Deleted bookings for 60 days, then gone for good.`)) return;
    try {
      await fetch(`/api/admin/bookings/${id}`, { method: 'DELETE' });
      setBookings(prev => prev.filter(b => b.id !== id));
      toast.success('Booking deleted — restorable from Settings for 60 days');
      fetchData();
    } catch { toast.error('Delete failed'); }
  };

  // Drag-and-drop reorder (select mode) — the actual gesture handling lives
  // in SelectModeList (isolated so a fast-moving drag only re-renders that
  // small component, not this whole page). This is just the data-side:
  // persist the new sort_order, then fold the reordered ids back into
  // `bookings` so the list reflects it without waiting on a refetch.
  const persistOrder = async (ids: string[]) => {
    try {
      await fetch('/api/admin/bookings/reorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      });
      setSortField('sortOrder'); setSortOrder('asc');
    } catch { toast.error('Could not save order'); }
  };
  const onReorderDragItems = (ids: string[]) => {
    const byId = new Map(bookings.map(b => [b.id, b]));
    const visibleIdSet = new Set(viewBookings.map(b => b.id));
    let k = 0;
    setBookings(bookings.map(b => visibleIdSet.has(b.id) ? byId.get(ids[k++])! : b));
    persistOrder(ids);
  };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  // Export moved to Settings -> Export bookings (kept the toolbar less crowded).

  const SortIcon = ({ field }: { field: string }) => (
    sortField === field
      ? sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3 opacity-30" />
  );

  const monthTrend = stats && stats.lastMonth > 0
    ? Math.round(((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100)
    : undefined;

  const navItems = adminNavItems({ onTab: setActiveTab, pending: stats?.uncontacted ?? 0 });

  // Grouped bookings collapse into one row instead of showing as separate
  // lines — fewer rows to scan. The group sits inline with everything else,
  // at the position of its most recently added member: `bookings` is already
  // in the current sort order, so the first member hit while walking that
  // order IS the group's most-recent job (default sort is createdAt desc).
  const visibleBookings = showPaid ? bookings : bookings.filter(b => !b.paid);
  // Leads vs Pipeline sub-tab, applied client-side on top of the shared fetch
  // (see bookingsView above) — never touches `bookings` itself, so Overview's
  // widgets (which read the same state) keep seeing everything.
  const viewStatuses = bookingsView === 'leads' ? LEADS_STATUSES : PIPELINE_STATUSES;
  const viewBookings = visibleBookings.filter(b => viewStatuses.includes(b.status));
  // Counts for the Leads/Pipeline toggle badges — always both, regardless of
  // which view is currently active, so the count on the OTHER tab is visible too.
  const leadsCount = visibleBookings.filter(b => LEADS_STATUSES.includes(b.status)).length;
  const pipelineCount = visibleBookings.filter(b => PIPELINE_STATUSES.includes(b.status)).length;
  // Cold leads get pulled out of the main list into their own collapsible
  // section below it — but only when browsing "All Status"; picking the
  // "Cold Lead" filter explicitly should still show them inline as normal.
  const coldBookings = statusFilter.length === 0 ? viewBookings.filter(b => b.status === 'cold') : [];
  const mainBookings = statusFilter.length === 0 ? viewBookings.filter(b => b.status !== 'cold') : viewBookings;
  const bookingsByGroup = new Map<string, Booking[]>();
  for (const b of mainBookings) {
    if (!b.groupId) continue;
    const list = bookingsByGroup.get(b.groupId) ?? [];
    list.push(b);
    bookingsByGroup.set(b.groupId, list);
  }
  const listItems: ListItem[] = [];
  const seenGroups = new Set<string>();
  for (const b of mainBookings) {
    if (!b.groupId) { listItems.push({ kind: 'booking', booking: b }); continue; }
    if (seenGroups.has(b.groupId)) continue;
    seenGroups.add(b.groupId);
    const group = groups.find(g => g.id === b.groupId);
    if (!group) { listItems.push({ kind: 'booking', booking: b }); continue; }
    listItems.push({ kind: 'group', group, members: bookingsByGroup.get(b.groupId) ?? [] });
  }

  // Same collapse, but over the full select-mode set (visibleBookings, which
  // — unlike mainBookings — still includes cold leads, so they can be
  // selected/dragged too) — a grouped booking drags as its whole group.
  const dragItems: ListItem[] = (() => {
    const byGroup = new Map<string, Booking[]>();
    for (const b of viewBookings) {
      if (!b.groupId) continue;
      const list = byGroup.get(b.groupId) ?? [];
      list.push(b); byGroup.set(b.groupId, list);
    }
    const items: ListItem[] = [];
    const seen = new Set<string>();
    for (const b of viewBookings) {
      if (!b.groupId) { items.push({ kind: 'booking', booking: b }); continue; }
      if (seen.has(b.groupId)) continue;
      seen.add(b.groupId);
      const group = groups.find(g => g.id === b.groupId);
      if (!group) { items.push({ kind: 'booking', booking: b }); continue; }
      items.push({ kind: 'group', group, members: byGroup.get(b.groupId) ?? [] });
    }
    return items;
  })();
  const toggleGroupSel = (members: Booking[]) => setSelected(s => {
    const n = new Set(s);
    const allOn = members.every(m => n.has(m.id));
    members.forEach(m => allOn ? n.delete(m.id) : n.add(m.id));
    return n;
  });

  const rowActions: BookingRowActions = {
    guestName, onOpen: openBooking, onInlineStatus, onTogglePaid,
    onManage: setManage, onRemove: removeBooking, onFlag: setFlagTarget,
  };

  // Business/Site stats are two tabs under one "Stats" nav entry now — both map to it.
  const navActive = activeTab === 'business' || activeTab === 'site' ? 'stats' : activeTab;

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active={navActive} items={navItems} />

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
            {(activeTab === 'business' || activeTab === 'site') && (
              <div className="hidden sm:inline-flex rounded-lg border border-white/10 bg-navy-900/60 p-1">
                <button onClick={() => setActiveTab('business')} className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${activeTab === 'business' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Business</button>
                <button onClick={() => setActiveTab('site')} className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${activeTab === 'site' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Site</button>
              </div>
            )}
            {activeTab === 'bookings' && (
              <div className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-white/10 bg-navy-900/60 p-1">
                <button onClick={() => switchBookingsView('leads')} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${bookingsView === 'leads' ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30' : 'text-slate-400 hover:text-white'}`}>
                  <PhoneCall className="w-3.5 h-3.5" /> Leads
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] leading-none ${bookingsView === 'leads' ? 'bg-white/20' : 'bg-white/10'}`}>{leadsCount}</span>
                </button>
                <button onClick={() => switchBookingsView('pipeline')} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${bookingsView === 'pipeline' ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30' : 'text-slate-400 hover:text-white'}`}>
                  <Layers className="w-3.5 h-3.5" /> Pipeline
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] leading-none ${bookingsView === 'pipeline' ? 'bg-white/20' : 'bg-white/10'}`}>{pipelineCount}</span>
                </button>
              </div>
            )}
            <button onClick={() => { setActiveTab('bookings'); setShowAdd(true); }} className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer">
              <Plus className="w-4 h-4" /> Add Booking
            </button>
            <button onClick={() => { if (activeTab === 'business') fetchBusiness(); else if (activeTab === 'site') fetchSite(); else if (activeTab === 'bookings') syncFacebookLeadsAndRefresh(); else fetchData(); }} title={activeTab === 'bookings' ? 'Refresh — also checks for new Facebook leads' : 'Refresh'} className="p-2 rounded-xl glass border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <RefreshCw className={`w-4 h-4 ${(loading || bizLoading || siteLoading || fbSyncing) ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={logout} className="lg:hidden p-2 rounded-xl glass border border-white/10 text-red-400 cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
        {(activeTab === 'business' || activeTab === 'site') && (
          <div className="sm:hidden px-4 pt-3">
            <div className="inline-flex rounded-lg border border-white/10 bg-navy-900/60 p-1">
              <button onClick={() => setActiveTab('business')} className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${activeTab === 'business' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Business</button>
              <button onClick={() => setActiveTab('site')} className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${activeTab === 'site' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Site</button>
            </div>
          </div>
        )}
        {activeTab === 'bookings' && (
          <div className="sm:hidden px-4 pt-3">
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-navy-900/60 p-1.5">
              <button
                onClick={() => switchBookingsView('leads')}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all ${bookingsView === 'leads' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'text-slate-400'}`}
              >
                <PhoneCall className="w-4 h-4" /> Leads
                <span className={`min-w-[1.35rem] h-[1.35rem] px-1 rounded-full text-[11px] font-bold flex items-center justify-center ${bookingsView === 'leads' ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-400'}`}>{leadsCount}</span>
              </button>
              <button
                onClick={() => switchBookingsView('pipeline')}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all ${bookingsView === 'pipeline' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'text-slate-400'}`}
              >
                <Layers className="w-4 h-4" /> Pipeline
                <span className={`min-w-[1.35rem] h-[1.35rem] px-1 rounded-full text-[11px] font-bold flex items-center justify-center ${bookingsView === 'pipeline' ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-400'}`}>{pipelineCount}</span>
              </button>
            </div>
          </div>
        )}

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
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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

                <UpcomingJobs bookings={bookings} />

                {/* Action needed: fresh leads to call + money owed — the two lists that make you money */}
                {!loading && (() => {
                  const leads = bookings.filter(b => b.status === 'uncontacted').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5);
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
                              <li key={b.id} className="py-2">
                                <div className="flex items-center gap-3">
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
                                </div>
                                {/* Only website leads need this — manual adds were already "contacted" by definition */}
                                {b.source === 'website' && (
                                  <button onClick={() => markContacted(b)} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 text-xs font-semibold cursor-pointer">
                                    <PhoneCall className="w-3.5 h-3.5" /> Mark as Contacted
                                  </button>
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
                                      <div className="text-slate-500 text-xs flex items-center gap-1.5 flex-wrap">
                                        <span>{b.completedAt ? `Done ${new Date(b.completedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : 'Completed'}</span>
                                        {invoicedBookingIds.has(b.id) ? (
                                          <span className="inline-flex items-center gap-1 text-emerald-400" title="An invoice is linked to this job">
                                            <FileText className="w-3 h-3" /> Invoiced
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 text-amber-400" title="No invoice linked to this job yet">
                                            <AlertTriangle className="w-3 h-3" /> No invoice
                                          </span>
                                        )}
                                      </div>
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
                        <Link href="/admin/invoices" className="glass rounded-2xl border border-white/8 p-5 flex items-center gap-3 hover:border-sky-400/30 transition-colors cursor-pointer">
                          <span className="w-10 h-10 rounded-xl bg-sky-400/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-5 h-5 text-sky-400" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-white text-sm font-semibold">Invoices</span>
                            <span className="block text-slate-500 text-xs mt-0.5">Create &amp; send an invoice</span>
                          </span>
                          <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        </Link>

                        {/* Guest logins + view-as selector */}
                        <div className="glass rounded-2xl border border-white/8 p-5">
                          <div className="flex items-center gap-3">
                            <span className="w-10 h-10 rounded-xl bg-sky-400/10 flex items-center justify-center flex-shrink-0">
                              <Users className="w-5 h-5 text-sky-400" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-white text-sm font-semibold">Guest logins</span>
                              <span className="block text-slate-500 text-xs mt-0.5">
                                {guests.filter(g => g.active).length} active
                              </span>
                            </span>
                            <Link href="/admin/settings" className="flex-shrink-0 text-xs text-sky-400 hover:text-sky-300 cursor-pointer">Manage</Link>
                          </div>
                          {guests.filter(g => g.active).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <div className="text-slate-500 text-[11px] mb-2">View dashboard as</div>
                              <div className="flex flex-wrap gap-2">
                                {guests.filter(g => g.active).map(g => (
                                  <button key={g.id} onClick={() => viewAsGuest(g.id)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/40 text-xs font-semibold cursor-pointer">
                                    <Eye className="w-3.5 h-3.5" /> {g.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

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
                    <MultiSelectDropdown
                      label="Status"
                      options={[...viewStatuses.map(s => ({ value: s, label: STATUS_CONFIG[s].label })), { value: 'facebook-lead-ad', label: 'Facebook Lead' }]}
                      selected={statusFilter}
                      onChange={setStatusFilter}
                    />
                    <MultiSelectDropdown
                      label="Services"
                      options={[
                        { value: 'window-washing', label: 'Window' },
                        { value: 'pressure-washing', label: 'Pressure' },
                        { value: 'both', label: 'Both' },
                        { value: 'flyscreen-repair', label: 'Flyscreen' },
                        { value: 'solar-panel-cleaning', label: 'Solar Panel' },
                        { value: 'other', label: 'Other' },
                      ]}
                      selected={serviceFilter}
                      onChange={setServiceFilter}
                    />
                    <label className="inline-flex items-center justify-center gap-2 px-3 py-2.5 glass border border-white/10 text-slate-300 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={showPaid}
                        onChange={e => setShowPaid(e.target.checked)}
                        className="appearance-none w-4 h-4 rounded border border-white/25 bg-white/10 checked:bg-sky-500 checked:border-sky-500 cursor-pointer relative before:content-['✓'] before:absolute before:inset-0 before:flex before:items-center before:justify-center before:text-[10px] before:leading-none before:text-white before:opacity-0 checked:before:opacity-100"
                      />
                      Show paid
                    </label>
                    <button onClick={() => setShowAdd(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap">
                      <Plus className="w-4 h-4" /> Add Booking
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1">
                  <div className="text-slate-500 text-sm">
                    {loading ? 'Loading...' : `${mainBookings.length} ${bookingsView === 'leads' ? 'lead' : 'job'}${mainBookings.length !== 1 ? 's' : ''}`}
                  </div>
                  <button onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${selectMode ? 'bg-sky-500 text-white' : 'glass border border-white/10 text-slate-300 hover:text-white'}`}>
                    <CheckSquare className="w-4 h-4" /> {selectMode ? 'Done' : 'Select'}
                  </button>
                </div>

                {/* Bulk select list + action bar */}
                {selectMode && (
                  <div className="space-y-2 pb-24">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setSelected(new Set(viewBookings.map(b => b.id)))} className="text-sky-400 text-xs font-semibold cursor-pointer">Select all ({viewBookings.length})</button>
                      <span className="text-slate-600 text-xs inline-flex items-center gap-1"><GripVertical className="w-3 h-3" /> Drag to reorder</span>
                    </div>
                    <SelectModeList
                      items={dragItems}
                      selected={selected}
                      onToggleSel={toggleSel}
                      onToggleGroupSel={toggleGroupSel}
                      onReorder={onReorderDragItems}
                    />
                    {selected.size > 0 && (
                      <div className="fixed bottom-0 inset-x-0 lg:left-64 z-40 bg-navy-800/95 backdrop-blur border-t border-white/10 p-3 safe-bottom">
                        <div className="max-w-3xl mx-auto flex items-center gap-2 flex-wrap">
                          <span className="text-white text-sm font-semibold">{selected.size} selected</span>
                          <select onChange={e => { if (e.target.value) bulkAction({ action: 'status', status: e.target.value }, 'Status updated'); e.target.value = ''; }} disabled={bulkBusy} className="form-input text-sm py-1.5 w-auto">
                            <option value="">Change status…</option>
                            {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                          </select>
                          <button onClick={() => setShowGroupModal(true)} disabled={bulkBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-sm font-semibold cursor-pointer"><Layers className="w-4 h-4" /> Group</button>
                          <button onClick={() => { if (window.confirm(`Delete ${selected.size} booking(s)? Kept in Settings -> Deleted bookings for 60 days, then gone for good.`)) bulkAction({ action: 'delete' }, 'Bookings deleted — restorable from Settings for 60 days'); }} disabled={bulkBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-400/30 bg-red-500/10 text-red-300 text-sm font-semibold cursor-pointer"><Trash2 className="w-4 h-4" /> Delete</button>
                          <button onClick={clearSel} className="ml-auto text-slate-400 text-sm cursor-pointer">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!selectMode && (<>
                {/* Mobile cards (phone-first). Grouped bookings collapse into one
                    card, positioned by their most recently added job, instead of
                    each appearing separately. */}
                <div className="lg:hidden space-y-3">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-4 h-32 animate-pulse" />)
                  ) : mainBookings.length === 0 ? (
                    <div className="glass rounded-2xl border border-white/8 p-10 text-center text-slate-600">
                      <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" /> No bookings found
                    </div>
                  ) : listItems.map((item) => item.kind === 'booking'
                    ? <BookingCard key={item.booking.id} b={item.booking} actions={rowActions} />
                    : (
                      <GroupBlock
                        key={item.group.id}
                        group={item.group}
                        members={item.members}
                        open={expandedGroups.has(item.group.id)}
                        onToggle={() => toggleGroupExpanded(item.group.id)}
                        onDelete={() => setDelGroup(item.group)}
                        actions={rowActions}
                      />
                    ))}
                </div>

                {/* Table (desktop) */}
                <div className="hidden lg:block glass rounded-2xl border border-white/8 overflow-hidden">
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_3rem_auto] gap-4 px-6 py-3 border-b border-white/5 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-white/2">
                    {[
                      { label: 'Customer', field: 'name' },
                      { label: 'Service', field: 'service' },
                      { label: 'Date Added', field: 'createdAt' },
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
                  ) : mainBookings.length === 0 ? (
                    <div className="px-6 py-16 text-center text-slate-600">
                      <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      No bookings found
                    </div>
                  ) : (
                    listItems.map((item) => item.kind === 'booking'
                      ? <BookingRow key={item.booking.id} b={item.booking} actions={rowActions} />
                      : (
                        <GroupBlock
                          key={item.group.id}
                          group={item.group}
                          members={item.members}
                          open={expandedGroups.has(item.group.id)}
                          onToggle={() => toggleGroupExpanded(item.group.id)}
                          onDelete={() => setDelGroup(item.group)}
                          actions={rowActions}
                        />
                      ))
                  )}
                </div>
                </>)}

                {!selectMode && (
                  <ColdLeadsSection
                    bookings={coldBookings}
                    open={coldOpen}
                    onToggle={() => setColdOpen(o => !o)}
                    onOpen={openBooking}
                    onRevive={openRevive}
                  />
                )}

                {!selectMode && <p className="text-slate-600 text-xs px-1">
                  Change status in the dropdown. Choosing <span className="text-violet-300">Quoted</span> asks for the amount. Click the pencil to add notes or edit a quote.
                </p>}
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

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard
                        label="Avg Debtor Days"
                        value={bizStats.avgDebtorDays != null ? `${bizStats.avgDebtorDays}d` : '-'}
                        icon={CalendarClock}
                        color="#818CF8"
                        sub="Invoice sent → job paid"
                      />
                      <StatCard
                        label="Overdue Invoices"
                        value={String(bizStats.overdueCount)}
                        icon={AlertTriangle}
                        color={bizStats.overdueCount > 0 ? '#F87171' : '#34D399'}
                        sub={bizStats.overdueCount > 0 ? `${money(bizStats.overdueValue)} overdue` : 'None overdue'}
                      />
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
                          <SourceRow label="Facebook lead ad" value={bizStats.leadsBySource.facebookLeadAd} total={bizStats.total} color="#60A5FA" />
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

                    {/* How we got the job — from "How did we get this job?" on manual adds */}
                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-sky-400" /> Customer sources</h3>
                      {(() => {
                        const data = LEAD_SOURCE_OPTIONS.map(o => ({ label: o.l, value: bookings.filter(b => b.leadSource === o.v).length }));
                        const total = data.reduce((s, d) => s + d.value, 0);
                        if (total === 0) return <div className="text-slate-600 text-sm py-6 text-center">No source data yet. Set &ldquo;How did we get this job?&rdquo; when adding a booking.</div>;
                        return (
                          <div className="space-y-3">
                            {data.filter(d => d.value > 0).sort((a, b) => b.value - a.value).map((d, i) => (
                              <SourceRow key={d.label} label={d.label} value={d.value} total={total} color={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Auto-captured for website bookings — see src/lib/attribution.ts */}
                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-1 flex items-center gap-2"><Compass className="w-4 h-4 text-sky-400" /> Website booking sources</h3>
                      <p className="text-slate-600 text-xs mb-4">How website bookings found us. Facebook/Instagram bio links and Google Maps only show up distinctly if those links are UTM-tagged.</p>
                      {(() => {
                        const counts: Record<string, number> = {};
                        bookings.forEach(b => { if (b.source === 'website' && b.attributionSource) counts[b.attributionSource] = (counts[b.attributionSource] ?? 0) + 1; });
                        const data = Object.entries(counts).map(([label, value]) => ({ label, value }));
                        const total = data.reduce((s, d) => s + d.value, 0);
                        if (total === 0) return <div className="text-slate-600 text-sm py-6 text-center">No website bookings with source data yet.</div>;
                        return (
                          <div className="space-y-3">
                            {data.sort((a, b) => b.value - a.value).map((d, i) => (
                              <SourceRow key={d.label} label={d.label} value={d.value} total={total} color={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ── SITE STATS (traffic) ────────────────────────────────── */}
            {activeTab === 'site' && (
              <motion.div key="site" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {siteLoading || !siteStats ? (
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-6 h-32 animate-pulse" />)}
                  </div>
                ) : siteStats.allTimeViews === 0 ? (
                  <div className="glass rounded-2xl border border-white/8 p-12 text-center">
                    <Globe className="w-10 h-10 mx-auto mb-4 text-slate-600" />
                    <div className="text-white font-semibold mb-1">No traffic data yet</div>
                    <p className="text-slate-500 text-sm max-w-md mx-auto">Visits are recorded as people browse the public site. Numbers will appear here once visitors land on the site (admin pages aren&apos;t tracked).</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                      <StatCard label="Views Today" value={siteStats.today} icon={Eye} color="#38BDF8" sub="Page views" />
                      <StatCard label="Last 7 Days" value={siteStats.last7} icon={TrendingUp} color="#818CF8" sub="Page views" />
                      <StatCard label="Unique Visitors" value={siteStats.uniqueVisitors} icon={Users} color="#A78BFA" sub="Last 30 days" />
                      <StatCard label="Total Views" value={siteStats.allTimeViews} icon={Globe} color="#34D399" sub="All time" />
                      <StatCard
                        label="Avg Time on Site"
                        value={formatDuration(siteStats.avgSessionDurationSeconds)}
                        icon={Timer}
                        color="#F472B6"
                        sub={siteStats.sessionSamples ? `${siteStats.sessionSamples} sessions` : 'No data yet'}
                      />
                    </div>

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-6">Views: Last 14 Days</h3>
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
                        <h3 className="font-display font-semibold text-white mb-1 flex items-center gap-2"><Eye className="w-4 h-4 text-sky-400" /> Top Pages</h3>
                        <p className="text-slate-600 text-xs mb-4">Scroll % and time are how far down the page and how long people spent, on average, before leaving.</p>
                        <div className="space-y-3">
                          {siteStats.topPages.map(p => (
                            <div key={p.path}>
                              <div className="flex items-center justify-between text-sm gap-3 mb-1">
                                <span className="text-slate-300 truncate">{p.path}</span>
                                <span className="flex items-center gap-2 whitespace-nowrap">
                                  {p.avgTimeOnPageSeconds !== null && (
                                    <span className="text-slate-500 text-xs">{formatDuration(p.avgTimeOnPageSeconds)}</span>
                                  )}
                                  {p.avgScrollPercent !== null && (
                                    <span className="text-slate-500 text-xs">{p.avgScrollPercent}% scroll</span>
                                  )}
                                  <span className="text-white font-semibold">{p.views}</span>
                                </span>
                              </div>
                              {p.avgScrollPercent !== null && (
                                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full bg-sky-400/70" style={{ width: `${p.avgScrollPercent}%` }} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="glass rounded-2xl border border-white/8 p-6">
                        <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2"><Link2 className="w-4 h-4 text-sky-400" /> Top Referrers</h3>
                        {siteStats.topReferrers.length === 0 ? (
                          <div className="text-slate-600 text-sm py-6 text-center">Mostly direct traffic, no external referrers yet</div>
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

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-1 flex items-center gap-2"><MoveDown className="w-4 h-4 text-sky-400" /> Scroll Depth: All Pages</h3>
                      {siteStats.scrollSampleCount === 0 ? (
                        <p className="text-slate-600 text-sm py-4 text-center">No scroll data yet, appears once visitors leave a page after it's loaded.</p>
                      ) : (
                        <>
                          <p className="text-slate-600 text-xs mb-4">How far down the page visitors got before leaving, across {siteStats.scrollSampleCount} recorded {siteStats.scrollSampleCount === 1 ? 'visit' : 'visits'} (last 30 days).</p>
                          <div className="space-y-2">
                            {siteStats.scrollBuckets.map(b => {
                              const pct = siteStats.scrollSampleCount ? Math.round((b.count / siteStats.scrollSampleCount) * 100) : 0;
                              return (
                                <div key={b.label} className="flex items-center gap-3 text-sm">
                                  <span className="text-slate-400 w-16 flex-shrink-0">{b.label}</span>
                                  <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                                    <div className="h-full bg-indigo-400/70" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-white font-semibold w-16 flex-shrink-0 text-right">{b.count} ({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="glass rounded-2xl border border-white/8 p-6">
                      <h3 className="font-display font-semibold text-white mb-1 flex items-center gap-2"><ListChecks className="w-4 h-4 text-sky-400" /> Booking Form Funnel</h3>
                      {siteStats.bookingFunnelStarted === 0 ? (
                        <p className="text-slate-600 text-sm py-4 text-center">No one has started filling in the booking form yet in this window.</p>
                      ) : (
                        <>
                          <p className="text-slate-600 text-xs mb-4">
                            How far people get through the booking form before leaving or submitting. {siteStats.bookingFunnelStarted} {siteStats.bookingFunnelStarted === 1 ? 'person has' : 'people have'} started it (last 30 days).
                          </p>
                          <div className="space-y-2">
                            {siteStats.bookingFunnel.map(s => {
                              const pct = siteStats.bookingFunnelStarted ? Math.round((s.count / siteStats.bookingFunnelStarted) * 100) : 0;
                              return (
                                <div key={s.step} className="flex items-center gap-3 text-sm">
                                  <span className="text-slate-400 w-40 flex-shrink-0 truncate">{s.label}</span>
                                  <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                                    <div className={`h-full ${s.step === 'submitted' ? 'bg-emerald-400/70' : 'bg-fuchsia-400/70'}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-white font-semibold w-20 flex-shrink-0 text-right">{s.count} ({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    <p className="text-slate-600 text-xs px-1">
                      Privacy-friendly: visitors counted via a daily hash, no raw IPs stored, scroll depth/time/funnel data carries no personal data. Admin pages excluded. Charts cover the last 30 days.
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <AdminMobileNav active={navActive} items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active={navActive} items={navItems} />

      {/* Manage modal */}
      <AnimatePresence>
        {manage && (
          <ManageModal
            booking={manage}
            onClose={() => setManage(null)}
            onSave={async (patch) => { await saveBooking(manage.id, patch); setManage(null); }}
          />
        )}
        {flagTarget && (
          <FlagModal
            booking={flagTarget}
            onClose={() => setFlagTarget(null)}
            onSave={(note) => flagSave(flagTarget, note)}
            onClear={() => flagClear(flagTarget)}
          />
        )}
        {showAdd && (
          <AddModal
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); fetchData(); }}
          />
        )}
        {showGroupModal && (
          <GroupModal count={selected.size} busy={bulkBusy} onClose={() => setShowGroupModal(false)} onCreate={createGroup} />
        )}
        {delGroup && (
          <DeleteGroupModal group={delGroup} onClose={() => setDelGroup(null)} onDelete={removeGroup} />
        )}
        {payInvoicePrompt && (
          <PayInvoiceModal
            booking={payInvoicePrompt.booking}
            invoice={payInvoicePrompt.invoice}
            onClose={() => setPayInvoicePrompt(null)}
            onConfirm={confirmPayInvoice}
          />
        )}
        {revive && (
          <ReviveModal
            booking={revive}
            status={reviveStatus}
            onChangeStatus={setReviveStatus}
            onClose={() => setRevive(null)}
            onSave={async () => { await saveBooking(revive.id, { status: reviveStatus }); setRevive(null); }}
          />
        )}
        {staleMoved.length > 0 && (
          <StaleMovedModal
            bookings={staleMoved}
            onOk={id => setStaleMoved(prev => prev.filter(b => b.id !== id))}
            onUndo={async (b) => {
              await saveBooking(b.id, { status: b.autoMovedFrom ?? 'uncontacted', autoMoved: false, autoMovedAt: null, autoMovedFrom: null });
              setStaleMoved(prev => prev.filter(x => x.id !== b.id));
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// This job has a linked invoice — marking it paid here settles the invoice
// too, so it asks how the customer actually paid (same choices as the
// invoices list's "Mark paid" picker) instead of just flipping a flag.
function PayInvoiceModal({ booking, invoice, onClose, onConfirm }: {
  booking: Booking; invoice: Invoice; onClose: () => void; onConfirm: (method: PaymentMethod) => void;
}) {
  const METHODS: PaymentMethod[] = ['bank_transfer', 'cash', 'card', 'other'];
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-400" /> Mark paid</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        <span className="text-white font-semibold">{booking.name}</span> has invoice <span className="text-white font-semibold">{invoice.number}</span> ({money(invoice.total)}) attached. How did they pay? This marks both the invoice and the job paid.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {METHODS.map(m => (
          <button key={m} onClick={() => onConfirm(m)} className="px-4 py-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 text-sm font-semibold cursor-pointer">
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="w-full mt-4 px-5 py-2.5 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white transition-all cursor-pointer">Cancel</button>
    </Overlay>
  );
}

// "Move back to active" — asks what status a cold lead should go back to,
// since there's no single obvious answer (could be uncontacted again, or
// straight to confirmed if you already know they're back on).
function ReviveModal({ booking, status, onChangeStatus, onClose, onSave }: {
  booking: Booking; status: BookingStatus; onChangeStatus: (s: BookingStatus) => void; onClose: () => void; onSave: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2"><Undo2 className="w-5 h-5 text-sky-400" /> Move back to active</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-slate-400 text-sm mb-3">What status should <span className="text-white font-semibold">{booking.name}</span> go back to?</p>
      <select value={status} onChange={e => onChangeStatus(e.target.value as BookingStatus)} className="form-input">
        {ACTIVE_STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
      </select>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="px-5 py-2.5 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white cursor-pointer">Cancel</button>
        <button onClick={onSave} className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-xl cursor-pointer">Save</button>
      </div>
    </Overlay>
  );
}

// One-time popup for whatever the auto-move checks just moved on this page
// load — OK dismisses, Undo puts it straight back. Two different moves can
// show up in the same list: Pipeline -> Leads (quoted/confirmed, unscheduled
// a week) and Leads -> Cold (uncontacted/contacted, untouched 14 days) —
// told apart by the booking's new .status (see checkUnscheduledPipeline /
// checkStaleLeads in db.ts), each with its own heading and reason.
function StaleMovedModal({ bookings, onOk, onUndo }: {
  bookings: Booking[]; onOk: (id: string) => void; onUndo: (b: Booking) => void;
}) {
  const toLeads = bookings.filter(b => b.status === 'uncontacted' || b.status === 'contacted');
  const toCold = bookings.filter(b => b.status === 'cold');

  const Group = ({ title, icon: Icon, reason, items }: { title: string; icon: React.FC<{ className?: string }>; reason: string; items: Booking[] }) => items.length === 0 ? null : (
    <div className="mb-4 last:mb-0">
      <h3 className="font-display text-base font-bold text-white flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-slate-400" /> {title}</h3>
      <p className="text-slate-400 text-sm mb-3">
        {items.length === 1 ? 'This job has' : `These ${items.length} jobs have`} {reason}, so {items.length === 1 ? 'it was' : 'they were'} automatically moved.
      </p>
      <div className="space-y-2">
        {items.map(b => (
          <div key={b.id} className="glass rounded-xl border border-white/8 p-3">
            <div className="text-white text-sm font-medium">{b.name}</div>
            <div className="text-slate-500 text-xs mb-2">{serviceText(b.service)}{b.suburb ? ` · ${b.suburb}` : ''}</div>
            <div className="flex gap-2">
              <button onClick={() => onOk(b.id)} className="flex-1 px-3 py-1.5 rounded-lg glass border border-white/10 text-slate-300 text-xs font-semibold cursor-pointer">OK</button>
              <button onClick={() => onUndo(b)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-xs font-semibold cursor-pointer">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Overlay onClose={() => bookings.forEach(b => onOk(b.id))}>
      <Group title="Back to Leads" icon={PhoneCall} reason="sat quoted with no calendar slot for 7 days" items={toLeads} />
      <Group title="Moved to Cold Lead" icon={Snowflake} reason="sat for 14 days with no update" items={toCold} />
    </Overlay>
  );
}

// ─── Group create + delete modals ────────────────────────────────────────

function GroupModal({ count, busy, onClose, onCreate }: {
  count: number; busy: boolean; onClose: () => void; onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2"><Layers className="w-5 h-5 text-sky-400" /> New group</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-slate-400 text-sm mb-3">Grouping {count} booking{count !== 1 ? 's' : ''}.</p>
      <input autoFocus className="form-input" placeholder="Group title (e.g. Aranda street run)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && title.trim()) onCreate(title.trim()); }} />
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="px-5 py-2.5 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white cursor-pointer">Cancel</button>
        <button onClick={() => title.trim() && onCreate(title.trim())} disabled={busy || !title.trim()} className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-xl cursor-pointer">Create group</button>
      </div>
    </Overlay>
  );
}

function DeleteGroupModal({ group, onClose, onDelete }: {
  group: BookingGroup; onClose: () => void; onDelete: (g: BookingGroup, withBookings: boolean) => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white">Delete &ldquo;{group.title}&rdquo;</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-3">
        <button onClick={() => onDelete(group, false)} className="w-full text-left p-4 rounded-xl border border-white/10 hover:border-sky-400/40 cursor-pointer">
          <div className="text-white font-semibold text-sm">Delete group only</div>
          <div className="text-slate-400 text-xs mt-0.5">Removes the group. All {group.jobCount} booking{group.jobCount !== 1 ? 's' : ''} are kept.</div>
        </button>
        <button
          onClick={() => { if (window.confirm(`This deletes the group AND all ${group.jobCount} booking(s) inside it. They're kept in Settings -> Deleted bookings for 60 days. Continue?`)) onDelete(group, true); }}
          className="w-full text-left p-4 rounded-xl border border-red-400/30 bg-red-500/5 hover:border-red-400/60 cursor-pointer"
        >
          <div className="text-red-300 font-semibold text-sm flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Delete group and contents</div>
          <div className="text-slate-400 text-xs mt-0.5">Deletes the group and all {group.jobCount} booking{group.jobCount !== 1 ? 's' : ''} (worth {money(group.totalValue)}) — kept in Settings -&gt; Deleted bookings for 60 days.</div>
        </button>
      </div>
    </Overlay>
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
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(booking.scheduledAt ?? null));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const q = quote.trim() === '' ? null : Number(quote.replace(/[^0-9.]/g, ''));
    // Confirming without a slot? Offer to add one (default: preferred date 9am, else tomorrow).
    let schedISO = fromLocalInput(scheduledAt);
    if (status === 'confirmed' && !schedISO) {
      if (window.confirm('Add this booking to the calendar?')) {
        const base = /^\d{4}-\d{2}-\d{2}$/.test(booking.preferredDate) ? booking.preferredDate : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        schedISO = new Date(`${base}T09:00:00`).toISOString();
      }
    }
    await onSave({ status, quoteAmount: q, adminNotes, paid, scheduledAt: schedISO });
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
        <div className="text-white font-semibold">{booking.name} {booking.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300">Added</span>}{booking.source === 'facebook-lead-ad' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 inline-flex items-center gap-1"><Facebook className="w-2.5 h-2.5" />FB Lead</span>}</div>
        <div className="text-slate-400">{booking.phone}{booking.email ? ` · ${booking.email}` : ''}</div>
        <div className="text-slate-400">{serviceText(booking.service)} · <span className="capitalize">{booking.propertyType}</span></div>
        {(booking.address || booking.suburb) && <div className="text-slate-500"><AddressLink address={[booking.address, booking.suburb].filter(Boolean).join(', ')} className="text-slate-500" /></div>}
        {(booking.preferredDate || booking.preferredTime) && <div className="text-slate-500">{booking.preferredDate} {booking.preferredTime}</div>}
        {booking.status === 'completed' && booking.completedAt && <div className="text-emerald-400 text-xs">Completed {new Date(booking.completedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
        {booking.notes && <div className="text-slate-500 pt-1 border-t border-white/5 mt-1">Customer note: {booking.notes}</div>}
      </div>

      <div className="mb-5">
        <Field label="Scheduled slot (calendar)">
          <div className="flex items-center gap-2">
            <input type="datetime-local" className="form-input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
            {scheduledAt && <button type="button" onClick={() => setScheduledAt('')} className="px-3 py-2.5 rounded-lg border border-white/10 text-slate-400 hover:text-white text-sm cursor-pointer">Clear</button>}
          </div>
        </Field>
      </div>

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
              <p className="text-emerald-400 text-xs mt-2">Multi-service: remember the bundle discount.</p>
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
        <Field label="How did we get this job?">
          <select className="form-input" value={f.leadSource} onChange={e => set('leadSource', e.target.value)}>
            <option value="">Not sure</option>
            {LEAD_SOURCE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
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
