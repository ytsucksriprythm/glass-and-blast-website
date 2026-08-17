'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { upload } from '@vercel/blob/client';
import {
  ArrowLeft, Settings as SettingsIcon, Save, ShieldAlert, CreditCard, Bell, Star,
  CalendarClock, Globe, ScrollText, RefreshCw, FileEdit, Trash2, Plus, Pencil, X, Check, MapPin, Sparkles,
  FolderOpen, UploadCloud, Copy, ExternalLink, FileVideo, FileImage, File as FileIcon,
} from 'lucide-react';
import type { AppSettings } from '@/lib/settings';
import type { PaymentProfile, BusinessProfile } from '@/lib/invoice';
import { ACTIVITY_TYPE_LABEL, type ActivityEntry } from '@/lib/activity';
import { APP_VERSION } from '@/lib/version';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import type { MediaItem } from '@/lib/media';

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-navy-800 p-4 sm:p-5">
      <h2 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-sky-400" /> {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1">{children}</label>;
}

const money = (n: number) => `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <L>{label}</L>
      <input
        type={type}
        className="form-input text-sm w-full"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// Themed checkbox-as-switch — blends with the dark card instead of a native
// white box, but stays clearly readable as a toggle.
function Toggle({ label, sub, checked, onChange, disabled }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-3 py-1.5 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <div className="min-w-0">
        <div className="text-white text-sm font-medium">{label}</div>
        {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 flex-shrink-0 appearance-none w-9 h-5 rounded-full border border-white/20 bg-white/10 checked:bg-sky-500 checked:border-sky-500 cursor-pointer disabled:cursor-not-allowed relative transition-colors before:content-[''] before:absolute before:top-[1px] before:left-[1px] before:w-[16px] before:h-[16px] before:rounded-full before:bg-slate-300 checked:before:bg-white before:transition-transform checked:before:translate-x-4"
      />
    </label>
  );
}

type FieldConfig = { key: string; label: string };

// Shared "list of named profiles, add/remove, plus an autofill toggle" UI —
// used for both business-info and payment-detail profiles. When only one
// (built-in) profile exists there's nothing to pick between, so the same
// single-profile-hides-the-picker rule from the invoice editor applies here
// too: with 1 profile there's just a plain "add another" affordance; once a
// second exists, this list is what makes the invoice-page picker appear.
function ProfileManager<T extends { id: string; name: string; builtin: boolean }>({
  title, icon, autofillLabel, autofillSub, autofillEnabled, onToggleAutofill,
  profiles, fields, onAdd, onUpdate, onDelete,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  autofillLabel: string;
  autofillSub: string;
  autofillEnabled: boolean;
  onToggleAutofill: (v: boolean) => void;
  profiles: T[];
  fields: FieldConfig[];
  onAdd: (data: Record<string, string>) => Promise<void>;
  onUpdate: (p: T, data: Record<string, string>) => Promise<void>;
  onDelete: (p: T) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Which profile (if any) is being edited inline, and its working copy.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const submit = async () => {
    if (!form.name?.trim()) { toast.error('Give the profile a name'); return; }
    setSaving(true);
    try { await onAdd(form); setOpen(false); setForm({}); }
    finally { setSaving(false); }
  };

  const startEdit = (p: T) => {
    const base: Record<string, string> = { name: p.name };
    for (const fc of fields) base[fc.key] = (p as unknown as Record<string, string>)[fc.key] ?? '';
    setEditForm(base);
    setEditingId(p.id);
  };
  const submitEdit = async (p: T) => {
    if (!editForm.name?.trim()) { toast.error('Give the profile a name'); return; }
    setSavingEdit(true);
    try { await onUpdate(p, editForm); setEditingId(null); }
    finally { setSavingEdit(false); }
  };

  return (
    <Section title={title} icon={icon}>
      <Toggle label={autofillLabel} sub={autofillSub} checked={autofillEnabled} onChange={onToggleAutofill} />
      <div className="space-y-2">
        {profiles.map(p => editingId === p.id ? (
          <div key={p.id} className="rounded-lg border border-sky-400/30 bg-sky-400/5 p-3 space-y-2">
            <input className="form-input text-sm w-full" placeholder="Profile name" value={editForm.name ?? ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              {fields.map(fc => (
                <input key={fc.key} className="form-input text-sm" placeholder={fc.label} value={editForm[fc.key] ?? ''} onChange={e => setEditForm(f => ({ ...f, [fc.key]: e.target.value }))} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => submitEdit(p)} disabled={savingEdit} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"><Check className="w-3.5 h-3.5" /> Save</button>
              <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-slate-300 hover:text-white cursor-pointer"><X className="w-3.5 h-3.5" /> Cancel</button>
            </div>
          </div>
        ) : (
          <div key={p.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium">{p.name}{p.builtin && <span className="text-slate-500 text-xs ml-1.5">(built-in)</span>}</div>
              <div className="text-slate-500 text-xs mt-0.5 truncate">
                {fields.map(fc => (p as unknown as Record<string, string>)[fc.key]).filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              <button onClick={() => startEdit(p)} title="Edit profile" className="text-slate-500 hover:text-sky-400 cursor-pointer"><Pencil className="w-4 h-4" /></button>
              {!p.builtin && (
                <button onClick={() => onDelete(p)} title="Delete profile" className="text-slate-500 hover:text-red-400 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      {profiles.length <= 1 && (
        <p className="text-slate-600 text-xs">Only one profile — the invoice page won&apos;t show a picker until a second one exists here.</p>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"><Plus className="w-3.5 h-3.5" /> Add profile</button>
      ) : (
        <div className="rounded-lg border border-sky-400/30 bg-sky-400/5 p-3 space-y-2">
          <input className="form-input text-sm w-full" placeholder="Profile name (e.g. Liam)" value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2">
            {fields.map(fc => (
              <input key={fc.key} className="form-input text-sm" placeholder={fc.label} value={form[fc.key] ?? ''} onChange={e => setForm(f => ({ ...f, [fc.key]: e.target.value }))} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving} className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">Save profile</button>
            <button onClick={() => { setOpen(false); setForm({}); }} className="px-3 py-2 rounded-lg border border-white/10 text-slate-300 hover:text-white cursor-pointer">Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ACTOR_STYLE = (actor: string) => {
  if (actor === 'admin') return 'bg-sky-400/15 text-sky-300 border-sky-400/25';
  if (actor === 'customer') return 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25';
  if (actor.startsWith('guest:')) return 'bg-violet-400/15 text-violet-300 border-violet-400/25';
  return 'bg-slate-400/15 text-slate-300 border-slate-400/25';
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIconFor(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return FileVideo;
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) return FileImage;
  return FileIcon;
}

// Public file host: ad videos, downloadable assets, anything the owner wants
// a plain shareable URL for (Meta ads, a link to send someone). Files here
// are NOT behind a password — the URL itself is the only thing gatekeeping
// them, same as any other Vercel Blob public file. Upload goes straight from
// the browser to Blob storage (bypassing our server) so large video files
// don't hit a request-size limit.
function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/media');
      if (res.ok) setItems(await res.json());
      else toast.error('Failed to load media library');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploads(list.map(f => ({ name: f.name, pct: 0 })));
    for (const file of list) {
      const safe = file.name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
      const pathname = `media/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
      try {
        await upload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/admin/media/upload',
          onUploadProgress: ({ percentage }) => {
            setUploads(u => u.map(x => x.name === file.name ? { ...x, pct: percentage } : x));
          },
        });
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'error'}`);
      }
    }
    setUploads([]);
    if (inputRef.current) inputRef.current.value = '';
    load();
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy — long-press the link to copy manually'),
    );
  };

  const deleteItem = async (item: MediaItem) => {
    if (!window.confirm(`Delete "${item.filename}"? This removes the public link — anywhere it's already shared will break.`)) return;
    setDeletingUrl(item.url);
    try {
      const res = await fetch(`/api/admin/media?url=${encodeURIComponent(item.url)}`, { method: 'DELETE' });
      if (res.ok) { setItems(prev => prev?.filter(x => x.url !== item.url) ?? null); toast.success('Deleted'); }
      else toast.error('Delete failed');
    } finally { setDeletingUrl(null); }
  };

  return (
    <Section title="Media library" icon={FolderOpen}>
      <p className="text-slate-500 text-xs -mt-1">
        Upload ad videos, images or other files here to get a plain public URL — no admin login needed to open it.
        Use it for Meta ads, sending a link, or embedding elsewhere.
      </p>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => onFilesChosen(e.target.files)} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploads.length > 0}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
      >
        <UploadCloud className="w-4 h-4" /> Upload files
      </button>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map(u => (
            <div key={u.name} className="text-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="truncate">{u.name}</span>
                <span>{Math.round(u.pct)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-sky-400 transition-all" style={{ width: `${u.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {loading && !items ? (
          <div className="text-center text-slate-600 text-xs py-6">Loading…</div>
        ) : !items || items.length === 0 ? (
          <div className="text-center text-slate-600 text-xs py-6">No files uploaded yet.</div>
        ) : items.map(item => {
          const Icon = fileIconFor(item.filename);
          return (
            <div key={item.url} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex items-start gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-sky-400/10 border border-sky-400/20 flex items-center justify-center">
                <Icon className="w-4 h-4 text-sky-400" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate" title={item.filename}>{item.filename}</div>
                <div className="text-slate-500 text-xs mt-0.5">{formatBytes(item.size)} · {timeAgo(item.uploadedAt)}</div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <button onClick={() => copyUrl(item.url)} title="Copy link" className="text-slate-500 hover:text-sky-400 cursor-pointer"><Copy className="w-4 h-4" /></button>
                <a href={item.url} target="_blank" rel="noopener noreferrer" title="Open" className="text-slate-500 hover:text-sky-400 cursor-pointer"><ExternalLink className="w-4 h-4" /></a>
                <button onClick={() => deleteItem(item)} disabled={deletingUrl === item.url} title="Delete" className="text-slate-500 hover:text-red-400 cursor-pointer disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/activity?limit=200');
      if (res.ok) setEntries(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <Section title="Activity log" icon={ScrollText}>
      <p className="text-slate-500 text-xs -mt-1 mb-1">Everything that happens on the site and in the CRM — bookings, invoices, settings changes, guest logins, Square payments.</p>
      <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 cursor-pointer disabled:opacity-50">
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </button>
      <div className="mt-2 max-h-[28rem] overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
        {loading && !entries ? (
          <div className="p-4 text-center text-slate-600 text-xs">Loading…</div>
        ) : !entries || entries.length === 0 ? (
          <div className="p-4 text-center text-slate-600 text-xs">Nothing logged yet.</div>
        ) : entries.map(e => (
          <div key={e.id} className="p-3 flex items-start gap-2.5">
            <span className={`flex-shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ACTOR_STYLE(e.actor)}`}>
              {e.actor.startsWith('guest:') ? 'guest' : e.actor}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-slate-200 text-xs">{e.summary}</div>
              <div className="text-slate-600 text-[11px] mt-0.5">{ACTIVITY_TYPE_LABEL[e.type] ?? e.type} · {timeAgo(e.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'guest' | null>(null);
  const [s, setS] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessProfiles, setBusinessProfiles] = useState<BusinessProfile[]>([]);
  const [paymentProfiles, setPaymentProfiles] = useState<PaymentProfile[]>([]);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  useEffect(() => {
    (async () => {
      try {
        const [meRes, settingsRes, bizRes, payRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/settings'),
          fetch('/api/admin/business-profiles'),
          fetch('/api/admin/payment-profiles'),
        ]);
        if (meRes.status === 401 || settingsRes.status === 401) { router.push('/admin'); return; }
        if (meRes.ok) setRole((await meRes.json()).role);
        if (settingsRes.ok) setS(await settingsRes.json());
        if (bizRes.ok) setBusinessProfiles(await bizRes.json());
        if (payRes.ok) setPaymentProfiles(await payRes.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  const addBusinessProfile = async (data: Record<string, string>) => {
    const res = await fetch('/api/admin/business-profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) { toast.error((await res.json()).error || 'Failed'); return; }
    const created: BusinessProfile = await res.json();
    setBusinessProfiles(ps => [...ps, created]);
    toast.success(`Saved profile "${created.name}"`);
  };
  const updateBusinessProfile = async (p: BusinessProfile, data: Record<string, string>) => {
    const res = await fetch(`/api/admin/business-profiles/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) { toast.error((await res.json()).error || 'Failed'); return; }
    const updated: BusinessProfile = await res.json();
    setBusinessProfiles(ps => ps.map(x => x.id === p.id ? updated : x));
    toast.success('Profile updated');
  };
  const deleteBusinessProfile = async (p: BusinessProfile) => {
    if (!window.confirm(`Delete business profile "${p.name}"?`)) return;
    const res = await fetch(`/api/admin/business-profiles/${p.id}`, { method: 'DELETE' });
    if (res.ok) { setBusinessProfiles(ps => ps.filter(x => x.id !== p.id)); toast.success('Profile deleted'); }
    else toast.error('Delete failed');
  };

  const addPaymentProfile = async (data: Record<string, string>) => {
    const res = await fetch('/api/admin/payment-profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.name, accountName: data.accountName, bsb: data.bsb, accountNumber: data.accountNumber }),
    });
    if (!res.ok) { toast.error((await res.json()).error || 'Failed'); return; }
    const created: PaymentProfile = await res.json();
    setPaymentProfiles(ps => [...ps, created]);
    toast.success(`Saved profile "${created.name}"`);
  };
  const updatePaymentProfile = async (p: PaymentProfile, data: Record<string, string>) => {
    const res = await fetch(`/api/admin/payment-profiles/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.name, accountName: data.accountName, bsb: data.bsb, accountNumber: data.accountNumber }),
    });
    if (!res.ok) { toast.error((await res.json()).error || 'Failed'); return; }
    const updated: PaymentProfile = await res.json();
    setPaymentProfiles(ps => ps.map(x => x.id === p.id ? updated : x));
    toast.success('Profile updated');
  };
  const deletePaymentProfile = async (p: PaymentProfile) => {
    if (!window.confirm(`Delete payment profile "${p.name}"?`)) return;
    const res = await fetch(`/api/admin/payment-profiles/${p.id}`, { method: 'DELETE' });
    if (res.ok) { setPaymentProfiles(ps => ps.filter(x => x.id !== p.id)); toast.success('Profile deleted'); }
    else toast.error('Delete failed');
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setS(prev => prev ? { ...prev, [key]: value } : prev);

  // LARP mode: an immediate action (not part of the Save-changes flow) — the
  // button itself calls start/stop, which generate/remove the fake bookings
  // server-side and flip larpModeActive there, so the button always reflects
  // ground truth even after a reload.
  const [larpBusy, setLarpBusy] = useState(false);
  // "Full Larper" is derived, not stored — always accurate, and turning off
  // any single category below naturally shows it as unchecked. Clicking it
  // is just a bulk setter for the five categories.
  const fullLarper = !!s && s.larpFakeNumbers && s.larpFakeBookings && s.larpFakeColdLeads && s.larpFakeInvoices && s.larpFakeCalendar;
  const toggleFullLarper = () => {
    const next = !fullLarper;
    (['larpFakeNumbers', 'larpFakeBookings', 'larpFakeColdLeads', 'larpFakeInvoices', 'larpFakeCalendar'] as const)
      .forEach(k => set(k, next));
  };
  const toggleLarp = async () => {
    if (!s) return;
    setLarpBusy(true);
    try {
      if (s.larpModeActive) {
        const res = await fetch('/api/admin/larp/stop', { method: 'POST' });
        if (!res.ok) throw new Error();
        const { bookings, invoices, recurring, pageViews } = await res.json();
        setS(prev => prev ? { ...prev, larpModeActive: false } : prev);
        toast.success(`LARP mode off — removed ${bookings} jobs, ${invoices} invoices, ${recurring} recurring plans, ${pageViews} page views`);
      } else {
        const res = await fetch('/api/admin/larp/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revenueTarget: s.larpRevenueTarget,
            fakeNumbers: s.larpFakeNumbers, fakeBookings: s.larpFakeBookings, fakeColdLeads: s.larpFakeColdLeads,
            fakeInvoices: s.larpFakeInvoices, fakeCalendar: s.larpFakeCalendar,
          }),
        });
        if (!res.ok) throw new Error();
        const { bookings, invoices, recurring, pageViews } = await res.json();
        setS(prev => prev ? { ...prev, larpModeActive: true } : prev);
        toast.success(`Larping — ${bookings} jobs, ${invoices} invoices, ${recurring} recurring plans, ${pageViews} page views added`);
      }
    } catch { toast.error('LARP mode failed — try again'); }
    finally { setLarpBusy(false); }
  };

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setS(await res.json());
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="settings" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
        >
          <button onClick={() => router.push('/admin/dashboard')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer lg:hidden">
            <ArrowLeft className="w-5 h-5" /> Dashboard
          </button>
          {role === 'admin' && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={toggleLarp}
                disabled={larpBusy || !s}
                title={s?.larpModeActive ? 'Turn LARP mode off — removes the fake data' : 'Turn LARP mode on — fills the CRM with fake data'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors disabled:opacity-50 ${s?.larpModeActive ? 'bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-300' : 'glass border border-white/10 text-slate-300 hover:text-white'}`}
              >
                {larpBusy && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {larpBusy ? (s?.larpModeActive ? 'Ending…' : 'Larping…') : (s?.larpModeActive ? 'Larping' : 'Larp')}
              </button>
              <button onClick={save} disabled={saving || !s} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">
                {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />} Save changes
              </button>
            </div>
          )}
        </header>

        <main className="max-w-2xl mx-auto w-full px-4 py-6 pb-28">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <SettingsIcon className="w-6 h-6 text-sky-400" /> Settings
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              Toggles apply immediately, no redeploy needed.
            </p>
          </div>

          {loading ? (
            <div className="space-y-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />)}</div>
          ) : role !== 'admin' ? (
            <div className="max-w-sm mx-auto text-center py-16">
              <span className="w-14 h-14 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-7 h-7 text-red-400" />
              </span>
              <h2 className="font-display text-xl font-bold text-white mt-4">Admin only</h2>
              <p className="text-slate-500 text-sm mt-2">Settings can only be changed by the master admin login.</p>
            </div>
          ) : s && (
            <div className="space-y-4">
              <ProfileManager<BusinessProfile>
                title="Invoice autofill — business info"
                icon={FileEdit}
                autofillLabel="Auto-fill business info"
                autofillSub="Pre-fills new invoices' 'From' block. Already-created invoices keep their own saved copy."
                autofillEnabled={s.autofillBusinessInfo}
                onToggleAutofill={v => set('autofillBusinessInfo', v)}
                profiles={businessProfiles}
                fields={[
                  // Same order these fields render in on the actual invoice (From block).
                  { key: 'fromName', label: 'Name' }, { key: 'fromTradingAs', label: 'Trading as' },
                  { key: 'fromAbn', label: 'ABN' }, { key: 'fromAddress', label: 'Address' },
                  { key: 'fromEmail', label: 'Email' }, { key: 'fromPhone', label: 'Phone' },
                ]}
                onAdd={addBusinessProfile}
                onUpdate={updateBusinessProfile}
                onDelete={deleteBusinessProfile}
              />

              <Section title="Invoice address display" icon={MapPin}>
                <Toggle
                  label="Show business address on new invoices (default)"
                  sub="Applies to normal invoices only — editable per invoice next to the address field. Tax invoices always show the address, regardless of this setting."
                  checked={s.defaultShowAddressOnInvoice}
                  onChange={v => set('defaultShowAddressOnInvoice', v)}
                />
              </Section>

              <ProfileManager<PaymentProfile>
                title="Invoice autofill — payment details"
                icon={FileEdit}
                autofillLabel="Auto-fill payment details"
                autofillSub="Pre-fills new invoices' bank details."
                autofillEnabled={s.autofillPaymentDetails}
                onToggleAutofill={v => set('autofillPaymentDetails', v)}
                profiles={paymentProfiles}
                fields={[
                  { key: 'accountName', label: 'Account name' }, { key: 'bsb', label: 'BSB' }, { key: 'accountNumber', label: 'Account number' },
                ]}
                onAdd={addPaymentProfile}
                onUpdate={updatePaymentProfile}
                onDelete={deletePaymentProfile}
              />

              <Section title="Card payments (Square)" icon={CreditCard}>
                <Toggle
                  label="Card payments enabled"
                  sub="Turns on the customer-facing Pay-by-card button, admin link generation, and the webhook all at once. Also needs SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID set in env — this toggle alone can't turn it on without those."
                  checked={s.squareCardPaymentsEnabled}
                  onChange={v => set('squareCardPaymentsEnabled', v)}
                />
                <Field label="Card surcharge (%)" type="number" value={s.squareSurchargePercent} onChange={v => set('squareSurchargePercent', Number(v) || 0)} />
                <p className="text-slate-600 text-xs">Check this against your actual contracted Square rate (Square dashboard → Fees).</p>
              </Section>

              <Section title="Notifications" icon={Bell}>
                <Toggle label="Notifications enabled" sub="Master switch — turns every push below on/off at once." checked={s.notificationsEnabled} onChange={v => set('notificationsEnabled', v)} />
                <div className="pl-1 border-l-2 border-white/5 ml-1 space-y-1">
                  <Toggle label="Job status changed" disabled={!s.notificationsEnabled} checked={s.notifyStatusChange} onChange={v => set('notifyStatusChange', v)} />
                  <Toggle label="Job sent to a subcontractor" disabled={!s.notificationsEnabled} checked={s.notifyJobAssigned} onChange={v => set('notifyJobAssigned', v)} />
                  <Toggle label="Customer taps &quot;I&apos;ve paid&quot;" disabled={!s.notificationsEnabled} checked={s.notifyCustomerMarkedPaid} onChange={v => set('notifyCustomerMarkedPaid', v)} />
                  <Toggle label="Square confirms a card payment" disabled={!s.notificationsEnabled} checked={s.notifySquarePaid} onChange={v => set('notifySquarePaid', v)} />
                  <Toggle label="New booking from the website" disabled={!s.notificationsEnabled} checked={s.notifyNewBooking} onChange={v => set('notifyNewBooking', v)} />
                </div>
              </Section>

              <Section title="Reviews & feedback" icon={Star}>
                <Toggle label="Customer feedback widget enabled" sub="Shows the star-rating prompt on the thank-you page at all." checked={s.customerFeedbackEnabled} onChange={v => set('customerFeedbackEnabled', v)} />
                <Field label="Google review link" value={s.googleReviewUrl} onChange={v => set('googleReviewUrl', v)} placeholder="https://g.page/r/.../review" />
                <div>
                  <L>Star rating that goes straight to Google</L>
                  <select className="form-input text-sm w-full" value={s.reviewStarThreshold} onChange={e => set('reviewStarThreshold', Number(e.target.value))}>
                    {[3, 4, 5].map(n => <option key={n} value={n}>{n}+ stars → Google review</option>)}
                  </select>
                  <p className="text-slate-600 text-xs mt-1">Ratings below this open a private feedback box instead.</p>
                </div>
              </Section>

              <Section title="Scheduling" icon={CalendarClock}>
                <Field label="Default job start time" type="time" value={s.defaultJobStartTime} onChange={v => set('defaultJobStartTime', v)} />
                <p className="text-slate-600 text-xs -mt-1">Used when a recurring plan auto-books its next visit. Manually scheduling a job on the calendar is unaffected.</p>
                <Toggle label="Recurring auto-book enabled" sub="Pauses the daily cron that turns due recurring plans into bookings, without deleting the plans. The manual &quot;generate next visit&quot; button still works." checked={s.recurringAutoBookEnabled} onChange={v => set('recurringAutoBookEnabled', v)} />
              </Section>

              <Section title="Public site" icon={Globe}>
                <Toggle label="Accepting new bookings" sub="Off shows a 'not currently taking new bookings' message instead of the booking form." checked={s.acceptingNewBookings} onChange={v => set('acceptingNewBookings', v)} />
                <Toggle label="Site visit tracking enabled" sub="Anonymous page-view tracking shown in Site Stats." checked={s.siteTrackingEnabled} onChange={v => set('siteTrackingEnabled', v)} />
              </Section>

              <Section title="LARP mode" icon={Sparkles}>
                <p className="text-slate-500 text-xs -mt-1">
                  Fills the CRM with realistic-looking fake bookings, revenue and a full calendar — for messing with mates.
                  Use the <span className="text-fuchsia-300 font-semibold">Larp</span> button up top to switch it on or off.
                  Nothing here is a real customer, and turning it off removes every fake thing it added — nothing else.
                </p>
                <div>
                  <div className="flex items-center justify-between mb-1 gap-3">
                    <L>Fake revenue target</L>
                    <input
                      type="number" min={10000} max={1000000} step={1000}
                      value={s.larpRevenueTarget}
                      disabled={s.larpModeActive}
                      onChange={e => set('larpRevenueTarget', Math.max(10000, Math.min(1000000, Number(e.target.value) || 10000)))}
                      className="form-input text-sm w-28 text-right disabled:opacity-50"
                    />
                  </div>
                  <input
                    type="range" min={10000} max={1000000} step={1000}
                    value={s.larpRevenueTarget}
                    disabled={s.larpModeActive}
                    onChange={e => set('larpRevenueTarget', Number(e.target.value))}
                    className="w-full accent-fuchsia-500 disabled:opacity-50 cursor-pointer"
                  />
                  <div className="flex items-center justify-between text-slate-600 text-[11px] mt-1">
                    <span>$10k</span><span>$1M</span>
                  </div>
                  {s.larpModeActive
                    ? <p className="text-amber-400 text-xs mt-2">Turn LARP mode off to change the target.</p>
                    : <p className="text-slate-600 text-xs mt-2">Higher targets mean a lot more jobs, not bigger individual invoices — kept realistic on purpose.</p>}
                </div>

                <div className="pt-3 mt-3 border-t border-white/5 space-y-1">
                  <Toggle
                    label="Full Larper"
                    sub="On when every category below is on. Flip it to switch all five at once."
                    checked={fullLarper}
                    disabled={s.larpModeActive}
                    onChange={toggleFullLarper}
                  />
                  <div className="pl-3 border-l border-white/10 ml-1 space-y-1">
                    <Toggle label="Fake numbers" sub="Site traffic — page views, unique visitors — for the Site Stats tab." checked={s.larpFakeNumbers} disabled={s.larpModeActive} onChange={v => set('larpFakeNumbers', v)} />
                    <Toggle label="Fake bookings" sub="The fake jobs themselves. Off means nothing below can generate either." checked={s.larpFakeBookings} disabled={s.larpModeActive} onChange={v => set('larpFakeBookings', v)} />
                    <Toggle label="Fake cold leads" sub="Some fake jobs land in Cold Lead status, same as a real 14-day auto-move." checked={s.larpFakeColdLeads} disabled={s.larpModeActive || !s.larpFakeBookings} onChange={v => set('larpFakeColdLeads', v)} />
                    <Toggle label="Fake invoices" sub="One invoice generated per fake job (numbered GB9000+, real numbering untouched)." checked={s.larpFakeInvoices} disabled={s.larpModeActive || !s.larpFakeBookings} onChange={v => set('larpFakeInvoices', v)} />
                    <Toggle label="Fake calendar" sub="Fake jobs get a scheduled slot, filling out the calendar." checked={s.larpFakeCalendar} disabled={s.larpModeActive || !s.larpFakeBookings} onChange={v => set('larpFakeCalendar', v)} />
                  </div>
                </div>
              </Section>

              <MediaLibrary />

              <ActivityLog />

              <p className="text-center text-slate-700 text-[10px] pt-2">v{APP_VERSION}</p>
            </div>
          )}
        </main>
      </div>
      <AdminMobileNav active="settings" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="settings" items={navItems} />
    </div>
  );
}
