'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import {
  LayoutDashboard, Calendar, LogOut, TrendingUp,
  Clock, CheckCircle, XCircle, Trash2, ChevronUp,
  ChevronDown, Search, RefreshCw, DollarSign,
  ArrowUpRight, ArrowDownRight, Edit3, Check, Plus, X, StickyNote,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Booking, BookingStatus } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────

interface Stats {
  total: number; thisMonth: number; lastMonth: number;
  pending: number; quoted: number; confirmed: number; completed: number; cancelled: number;
  quotedCount: number; quotedValue: number; wonValue: number; estimatedRevenue: number;
  byMonth: { month: string; count: number }[];
  serviceBreakdown: { name: string; value: number }[];
  avgPerMonth: number;
}

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
  'window-washing':   'Window Washing',
  'pressure-washing': 'Pressure Washing',
  'both':             'Both Services',
};

const PIE_COLORS = ['#38BDF8', '#818CF8', '#34D399'];

const money = (n?: number | null) =>
  typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '';

const emptyForm = {
  name: '', phone: '', email: '', service: 'window-washing', propertyType: 'residential',
  suburb: '', address: '', preferredDate: '', preferredTime: '', status: 'pending',
  quoteAmount: '', notes: '', adminNotes: '',
};

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

// ─── Main Dashboard ─────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings'>('overview');

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

  const logout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin');
  };

  // Quick inline status change. "Quoted" opens the manage modal to capture the amount.
  const onInlineStatus = (b: Booking, val: BookingStatus) => {
    if (val === 'quoted') { setManage({ ...b, status: 'quoted' }); return; }
    saveBooking(b.id, { status: val });
  };

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

  const SortIcon = ({ field }: { field: string }) => (
    sortField === field
      ? sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3 opacity-30" />
  );

  const monthTrend = stats && stats.lastMonth > 0
    ? Math.round(((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100)
    : undefined;

  return (
    <div className="min-h-screen bg-navy-900 flex">
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
        <header className="border-b border-white/5 bg-navy-800/50 backdrop-blur px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-white">
              {activeTab === 'overview' ? 'Dashboard Overview' : 'Bookings & Quotes'}
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => { setActiveTab('bookings'); setShowAdd(true); }} className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer">
              <Plus className="w-4 h-4" /> Add Booking
            </button>
            <button onClick={fetchData} className="p-2 rounded-xl glass border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={logout} className="lg:hidden p-2 rounded-xl glass border border-white/10 text-red-400 cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="lg:hidden flex gap-2 px-6 pt-4">
          {(['overview', 'bookings'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all cursor-pointer ${activeTab === t ? 'bg-sky-500 text-white' : 'glass border border-white/10 text-slate-400'}`}>
              {t}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <AnimatePresence mode="wait">
            {/* ── OVERVIEW ─────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {loading ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass rounded-2xl border border-white/8 p-6 h-32 animate-pulse" />)}
                  </div>
                ) : stats && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Total Bookings" value={stats.total} icon={Calendar} color="#38BDF8" sub="All time" />
                    <StatCard label="This Month" value={stats.thisMonth} icon={TrendingUp} color="#818CF8" trend={monthTrend} sub={`vs ${stats.lastMonth} last month`} />
                    <StatCard label="Quoted" value={money(stats.quotedValue) || '$0'} icon={DollarSign} color="#A78BFA" sub={`${stats.quotedCount} quote${stats.quotedCount !== 1 ? 's' : ''} out`} />
                    <StatCard label="Revenue (won)" value={money(stats.wonValue) || '$0'} icon={CheckCircle} color="#34D399" sub="Completed jobs" />
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
                    </select>
                    <button onClick={() => setShowAdd(true)} className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap">
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-white font-semibold flex items-center gap-2 flex-wrap">
                            {b.name}
                            {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
                          </div>
                          <a href={`tel:${b.phone}`} className="text-sky-400 text-sm cursor-pointer">{b.phone}</a>
                          <div className="text-slate-500 text-xs mt-0.5">{SERVICE_LABELS[b.service] ?? b.service} · <span className="capitalize">{b.propertyType}</span></div>
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
                      <div className="flex items-center gap-2 mt-3">
                        <select
                          value={b.status}
                          onChange={e => onInlineStatus(b, e.target.value as BookingStatus)}
                          className={`flex-1 text-sm font-semibold rounded-lg px-3 py-2.5 cursor-pointer bg-transparent border focus:outline-none badge-${b.status}`}
                        >
                          {STATUS_KEYS.map(s => <option key={s} value={s} className="bg-navy-800 text-white">{STATUS_CONFIG[s].label}</option>)}
                        </select>
                        <button onClick={() => setManage(b)} className="p-2.5 rounded-lg glass border border-white/10 text-sky-400 cursor-pointer" title="Manage / notes / quote">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => removeBooking(b.id)} className="p-2.5 rounded-lg glass border border-white/10 text-red-400 cursor-pointer" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Table (desktop) */}
                <div className="hidden lg:block glass rounded-2xl border border-white/8 overflow-hidden">
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 border-b border-white/5 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-white/2">
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
                    <div>Actions</div>
                  </div>

                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-white/5 animate-pulse">
                        {Array.from({ length: 6 }).map((_, j) => <div key={j} className="h-4 bg-white/5 rounded" />)}
                      </div>
                    ))
                  ) : bookings.length === 0 ? (
                    <div className="px-6 py-16 text-center text-slate-600">
                      <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      No bookings found
                    </div>
                  ) : (
                    bookings.map((b) => (
                      <motion.div key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-white/5 hover:bg-white/2 transition-colors items-center">
                        {/* Customer */}
                        <div className="min-w-0">
                          <div className="text-white text-sm font-medium flex items-center gap-2">
                            {b.name}
                            {b.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 border border-violet-400/20">Added</span>}
                          </div>
                          <div className="text-slate-500 text-xs">{b.phone}</div>
                          <div className="text-slate-600 text-xs truncate">{b.suburb}{b.address ? ` · ${b.address}` : ''}</div>
                        </div>
                        {/* Service */}
                        <div>
                          <div className="text-slate-300 text-sm">{SERVICE_LABELS[b.service] ?? b.service}</div>
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
                        {/* Actions */}
                        <div className="flex gap-2">
                          <button onClick={() => setManage(b)} className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-400/10 transition-all cursor-pointer" title="Manage / notes / quote">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
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
          </AnimatePresence>
        </main>
      </div>

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
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const q = quote.trim() === '' ? null : Number(quote.replace(/[^0-9.]/g, ''));
    await onSave({ status, quoteAmount: q, adminNotes });
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
        <div className="text-slate-400">{SERVICE_LABELS[booking.service] ?? booking.service} · <span className="capitalize">{booking.propertyType}</span></div>
        {(booking.address || booking.suburb) && <div className="text-slate-500">{booking.address}{booking.address && booking.suburb ? ', ' : ''}{booking.suburb}</div>}
        {(booking.preferredDate || booking.preferredTime) && <div className="text-slate-500">{booking.preferredDate} {booking.preferredTime}</div>}
        {booking.notes && <div className="text-slate-500 pt-1 border-t border-white/5 mt-1">Customer note: {booking.notes}</div>}
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

  const submit = async () => {
    if (!f.name || !f.phone) { toast.error('Name and phone are required'); return; }
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
        <Field label="Phone *"><input className="form-input" value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="form-input" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Suburb"><input className="form-input" value={f.suburb} onChange={e => set('suburb', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><input className="form-input" value={f.address} onChange={e => set('address', e.target.value)} /></Field></div>
        <Field label="Service">
          <select className="form-input" value={f.service} onChange={e => set('service', e.target.value)}>
            <option value="window-washing">Window Washing</option>
            <option value="pressure-washing">Pressure Washing</option>
            <option value="both">Both Services</option>
          </select>
        </Field>
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
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm overflow-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg my-8 glass border border-white/10 rounded-3xl p-6 shadow-2xl shadow-black/50"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
