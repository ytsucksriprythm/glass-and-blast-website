'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Plus, Trash2, Check, Copy, ExternalLink, Send, BadgeCheck, Undo2, FileText, Search, X, ClipboardList, Eye,
} from 'lucide-react';
import {
  type Invoice, type InvoiceStatus, type InvoiceLineItem, type PaymentProfile,
  BUSINESS_DEFAULTS, PAYMENT_DEFAULTS, addDays, computeTotals, money, longDate,
} from '@/lib/invoice';
import type { Booking } from '@/lib/db';
import InvoicePreview, { type InvoicePreviewData } from '@/components/InvoicePreview';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Cleaning',
  'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure Washing',
  'other': 'Cleaning Service',
};
const serviceText = (s: string) =>
  (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || 'Cleaning Service';

type ItemForm = { description: string; detail: string; serviceAddress: string; date: string; amount: string };

type Form = {
  isTaxInvoice: boolean;
  fromName: string; fromTradingAs: string; fromAbn: string; fromAddress: string; fromEmail: string; fromPhone: string;
  billToName: string; billToLines: string;
  clientShow: boolean; clientName: string; clientTrn: string; clientFileNo: string; clientClaimRef: string;
  invoiceDate: string; serviceDate: string; dueDate: string;
  items: ItemForm[];
  notes: string;
  payAccountName: string; payBsb: string; payAccountNumber: string;
};

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyItemForm(): ItemForm {
  return { description: '', detail: '', serviceAddress: '', date: '', amount: '' };
}

function fromInvoice(inv: Invoice): Form {
  return {
    isTaxInvoice: inv.isTaxInvoice,
    fromName: inv.fromName, fromTradingAs: inv.fromTradingAs, fromAbn: inv.fromAbn,
    fromAddress: inv.fromAddress, fromEmail: inv.fromEmail, fromPhone: inv.fromPhone,
    billToName: inv.billToName, billToLines: inv.billToLines,
    clientShow: inv.client.show, clientName: inv.client.clientName, clientTrn: inv.client.trn,
    clientFileNo: inv.client.fileNo, clientClaimRef: inv.client.claimRef,
    invoiceDate: inv.invoiceDate, serviceDate: inv.serviceDate, dueDate: inv.dueDate,
    items: inv.items.length
      ? inv.items.map(it => ({ description: it.description, detail: it.detail, serviceAddress: it.serviceAddress, date: it.date, amount: it.amount ? String(it.amount) : '' }))
      : [emptyItemForm()],
    notes: inv.notes,
    payAccountName: inv.payAccountName, payBsb: inv.payBsb, payAccountNumber: inv.payAccountNumber,
  };
}

// Auto-fill shape passed when creating an invoice from a booking.
export type InvoicePrefill = {
  billToName?: string;
  billToLines?: string;
  itemDescription?: string;
  itemDetail?: string;
  itemServiceAddress?: string;
  amount?: number | null;
  serviceDate?: string;
  bookingId?: string | null;
};

function blankForm(prefill?: InvoicePrefill): Form {
  const t = todayStr();
  return {
    isTaxInvoice: false,
    ...BUSINESS_DEFAULTS,
    billToName: prefill?.billToName ?? '',
    billToLines: prefill?.billToLines ?? '',
    clientShow: false, clientName: '', clientTrn: '', clientFileNo: '', clientClaimRef: '',
    invoiceDate: t, serviceDate: prefill?.serviceDate || t, dueDate: addDays(t, 30),
    items: [{
      ...emptyItemForm(),
      description: prefill?.itemDescription ?? '',
      detail: prefill?.itemDetail ?? '',
      serviceAddress: prefill?.itemServiceAddress ?? '',
      date: prefill?.serviceDate ?? '',
      amount: prefill?.amount ? String(prefill.amount) : '',
    }],
    notes: 'Thank you for your business.',
    ...PAYMENT_DEFAULTS,
  };
}

function toLineItems(items: ItemForm[]): InvoiceLineItem[] {
  return items.map(it => ({
    description: it.description.trim(),
    detail: it.detail.trim(),
    serviceAddress: it.serviceAddress.trim(),
    date: it.date,
    amount: Number(it.amount) || 0,
  }));
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-navy-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1">{children}</label>;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = { draft: 'Draft', sent: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
  sent: 'bg-sky-400/15 text-sky-300 border-sky-400/25',
  paid: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25',
  cancelled: 'bg-red-400/15 text-red-300 border-red-400/25',
};

export default function InvoiceEditor({ initial, prefill }: { initial: Invoice | null; prefill?: InvoicePrefill }) {
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(initial);
  const [f, setF] = useState<Form>(initial ? fromInvoice(initial) : blankForm(prefill));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [bookingId, setBookingId] = useState<string | null>(initial?.bookingId ?? prefill?.bookingId ?? null);

  // Payment profiles
  const [profiles, setProfiles] = useState<PaymentProfile[]>([]);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Copy-from-booking picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/payment-profiles');
        if (res.ok) setProfiles(await res.json());
      } catch { /* selector just won't show presets */ }
    })();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(prev => ({ ...prev, [k]: v }));
  const setItem = (i: number, k: keyof ItemForm, v: string) =>
    setF(prev => ({ ...prev, items: prev.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }));
  const addItem = () => setF(prev => ({ ...prev, items: [...prev.items, emptyItemForm()] }));
  const removeItem = (i: number) =>
    setF(prev => ({ ...prev, items: prev.items.length > 1 ? prev.items.filter((_, idx) => idx !== i) : prev.items }));

  // Payment profile helpers
  const applyProfile = (p: PaymentProfile) =>
    setF(prev => ({ ...prev, payAccountName: p.accountName, payBsb: p.bsb, payAccountNumber: p.accountNumber }));
  const applyOther = () =>
    setF(prev => ({ ...prev, payAccountName: '', payBsb: '', payAccountNumber: '' }));
  const activeProfileId = profiles.find(p =>
    p.accountName === f.payAccountName && p.bsb === f.payBsb && p.accountNumber === f.payAccountNumber
  )?.id ?? null;
  const isOther = !activeProfileId && !f.payAccountName && !f.payBsb && !f.payAccountNumber;

  const saveNewProfile = async () => {
    const name = newProfileName.trim();
    if (!name) { toast.error('Give the profile a name'); return; }
    setSavingProfile(true);
    try {
      const res = await fetch('/api/admin/payment-profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountName: f.payAccountName, bsb: f.payBsb, accountNumber: f.payAccountNumber }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const created: PaymentProfile = await res.json();
      setProfiles(ps => [...ps, created]);
      setNewProfileOpen(false); setNewProfileName('');
      toast.success(`Saved profile "${created.name}"`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
    finally { setSavingProfile(false); }
  };

  const deleteProfile = async (p: PaymentProfile) => {
    if (p.builtin) return;
    if (!window.confirm(`Delete payment profile "${p.name}"?`)) return;
    const res = await fetch(`/api/admin/payment-profiles/${p.id}`, { method: 'DELETE' });
    if (res.ok) { setProfiles(ps => ps.filter(x => x.id !== p.id)); toast.success('Profile deleted'); }
    else toast.error('Delete failed');
  };

  // Copy-from-booking helpers
  const openPicker = async () => {
    setPickerOpen(true);
    if (bookings === null) {
      try {
        const res = await fetch('/api/admin/bookings');
        const data = res.ok ? await res.json() : [];
        setBookings(Array.isArray(data) ? data : (data.bookings ?? []));
      } catch { setBookings([]); }
    }
  };
  const applyBooking = (b: Booking) => {
    const address = [b.address, b.suburb].filter(Boolean).join(', ');
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(b.preferredDate) ? b.preferredDate : '';
    setF(prev => ({
      ...prev,
      billToName: b.name || prev.billToName,
      billToLines: address || prev.billToLines,
      serviceDate: validDate || prev.serviceDate,
      items: prev.items.map((it, idx) => idx === 0 ? {
        ...it,
        description: serviceText(b.service),
        serviceAddress: address || it.serviceAddress,
        date: validDate || it.date,
        amount: (typeof b.quoteAmount === 'number' && b.quoteAmount > 0) ? String(b.quoteAmount) : it.amount,
      } : it),
    }));
    setBookingId(b.id);
    setPickerOpen(false);
    setPickerSearch('');
    toast.success(`Copied details from ${b.name}`);
  };
  const filteredBookings = (bookings ?? []).filter(b => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.phone, b.address, b.suburb].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const lineItems = useMemo(() => toLineItems(f.items), [f.items]);
  const { subtotal, total } = useMemo(() => computeTotals(lineItems), [lineItems]);

  const previewData: InvoicePreviewData = {
    number: inv?.number ?? 'GB####',
    isTaxInvoice: f.isTaxInvoice,
    fromName: f.fromName, fromTradingAs: f.fromTradingAs, fromAbn: f.fromAbn,
    fromAddress: f.fromAddress, fromEmail: f.fromEmail, fromPhone: f.fromPhone,
    billToName: f.billToName, billToLines: f.billToLines,
    client: { show: f.clientShow, clientName: f.clientName, trn: f.clientTrn, fileNo: f.clientFileNo, claimRef: f.clientClaimRef },
    invoiceDate: f.invoiceDate, serviceDate: f.serviceDate, dueDate: f.dueDate,
    items: lineItems, subtotal, total,
    notes: f.notes,
    payAccountName: f.payAccountName, payBsb: f.payBsb, payAccountNumber: f.payAccountNumber,
  };

  const payload = () => ({
    isTaxInvoice: f.isTaxInvoice,
    fromName: f.fromName, fromTradingAs: f.fromTradingAs, fromAbn: f.fromAbn,
    fromAddress: f.fromAddress, fromEmail: f.fromEmail, fromPhone: f.fromPhone,
    billToName: f.billToName, billToLines: f.billToLines,
    client: { show: f.clientShow, clientName: f.clientName, trn: f.clientTrn, fileNo: f.clientFileNo, claimRef: f.clientClaimRef },
    invoiceDate: f.invoiceDate, serviceDate: f.serviceDate, dueDate: f.dueDate,
    items: lineItems,
    notes: f.notes,
    payAccountName: f.payAccountName, payBsb: f.payBsb, payAccountNumber: f.payAccountNumber,
    bookingId,
  });

  const save = async () => {
    if (!f.billToName.trim() && !f.clientShow) { toast.error('Add who the invoice is billed to'); return; }
    if (lineItems.every(i => !i.description && !i.amount)) { toast.error('Add at least one line item'); return; }
    setSaving(true);
    try {
      if (inv) {
        const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
        if (res.status === 401) { router.push('/admin'); return; }
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        setInv(await res.json());
        toast.success('Invoice saved');
      } else {
        const res = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
        if (res.status === 401) { router.push('/admin'); return; }
        if (!res.ok) throw new Error((await res.json()).error || 'Create failed');
        const created: Invoice = await res.json();
        toast.success(`Invoice ${created.number} created`);
        router.push(`/admin/invoices/${created.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const setStatus = async (status: InvoiceStatus) => {
    if (!inv) return;
    const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (res.ok) { setInv(await res.json()); toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`); }
    else toast.error('Update failed');
  };

  const remove = async () => {
    if (!inv) return;
    if (!window.confirm(`Delete invoice ${inv.number}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Invoice deleted'); router.push('/admin/invoices'); }
    else toast.error('Delete failed');
  };

  const publicUrl = inv ? `${typeof window !== 'undefined' ? window.location.origin : ''}/invoice/${inv.token}` : '';
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl); toast.success('Link copied'); }
    catch { toast.error('Copy failed'); }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Share link + status (existing invoices) */}
      {inv && (
        <div className="mb-5 rounded-xl border border-sky-400/25 bg-sky-400/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
              <span className="text-white font-semibold">{inv.number}</span>
            </div>
            <div className="flex items-center gap-2">
              {inv.status !== 'sent' && <button onClick={() => setStatus('sent')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:border-sky-400/40 text-xs font-semibold cursor-pointer"><Send className="w-3.5 h-3.5" /> Mark sent</button>}
              {inv.status !== 'paid' && <button onClick={() => setStatus('paid')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:border-emerald-400/40 text-xs font-semibold cursor-pointer"><BadgeCheck className="w-3.5 h-3.5" /> Mark paid</button>}
              {inv.status !== 'draft' && <button onClick={() => setStatus('draft')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"><Undo2 className="w-3.5 h-3.5" /> Draft</button>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input readOnly value={publicUrl} className="form-input flex-1 min-w-[12rem] text-xs" onFocus={e => e.currentTarget.select()} />
            <button onClick={copyLink} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer"><Copy className="w-4 h-4" /> Copy link</button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/15 text-slate-200 hover:text-white text-sm font-semibold cursor-pointer"><ExternalLink className="w-4 h-4" /> Open</a>
          </div>
          <p className="mt-2 text-slate-500 text-xs">Send this link to the customer. They view the invoice and pay by bank transfer using reference <span className="text-sky-300 font-semibold">{inv.number}</span>.</p>
          {inv.firstViewedAt ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
              <Eye className="w-3.5 h-3.5" /> Customer opened this{inv.viewCount > 1 ? ` ${inv.viewCount} times` : ''} · last {longDate(inv.lastViewedAt || inv.firstViewedAt)}
            </p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-slate-500 text-xs">
              <Eye className="w-3.5 h-3.5" /> Not opened by the customer yet
            </p>
          )}
        </div>
      )}

      {/* Mobile edit/preview tabs */}
      <div className="lg:hidden mb-4 grid grid-cols-2 gap-2">
        {(['edit', 'preview'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer ${tab === t ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-400'}`}>
            {t === 'edit' ? 'Edit' : 'Preview'}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* ── Form ── */}
        <div className={`space-y-4 ${tab === 'edit' ? '' : 'hidden lg:block'}`}>
          <button type="button" onClick={openPicker} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-sky-400/40 bg-sky-400/5 text-sky-300 hover:bg-sky-400/10 text-sm font-semibold cursor-pointer">
            <ClipboardList className="w-4 h-4" /> Copy details from a booking
          </button>

          <Section title="Invoice type">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set('isTaxInvoice', false)} className={`px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer ${!f.isTaxInvoice ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>Invoice</button>
              <button type="button" onClick={() => set('isTaxInvoice', true)} className={`px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer ${f.isTaxInvoice ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>Tax Invoice</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">{f.isTaxInvoice ? 'Only use "Tax Invoice" if a client requires it — you’re not registered for GST.' : 'Compliant default: you’re not registered for GST, so this is titled "Invoice".'}</p>
          </Section>

          <Section title="Dates">
            <div className="grid grid-cols-3 gap-3">
              <div><L>Invoice date</L><input type="date" className="form-input text-sm" value={f.invoiceDate} onChange={e => { set('invoiceDate', e.target.value); }} /></div>
              <div><L>Service date</L><input type="date" className="form-input text-sm" value={f.serviceDate} onChange={e => set('serviceDate', e.target.value)} /></div>
              <div><L>Due date</L><input type="date" className="form-input text-sm" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></div>
            </div>
            <button type="button" onClick={() => set('dueDate', addDays(f.invoiceDate, 30))} className="mt-2 text-xs text-sky-400 hover:text-sky-300 cursor-pointer">Set due 30 days after invoice date</button>
          </Section>

          <Section title="Bill to">
            <div className="space-y-3">
              <div><L>Name / business</L><input className="form-input text-sm" value={f.billToName} onChange={e => set('billToName', e.target.value)} placeholder="Customer or organisation" /></div>
              <div><L>Extra lines (optional)</L><textarea className="form-input text-sm resize-none" rows={2} value={f.billToLines} onChange={e => set('billToLines', e.target.value)} placeholder="Attn / program / address" /></div>
            </div>
          </Section>

          <Section title="Client details" right={
            <button type="button" onClick={() => set('clientShow', !f.clientShow)} className={`text-xs font-semibold cursor-pointer ${f.clientShow ? 'text-sky-400' : 'text-slate-500'}`}>{f.clientShow ? 'Shown' : 'Hidden'}</button>
          }>
            <p className="text-xs text-slate-500 mb-3">Optional block for government / DVA jobs. Leave hidden for normal customers.</p>
            {f.clientShow && (
              <div className="grid grid-cols-2 gap-3">
                <div><L>Client name</L><input className="form-input text-sm" value={f.clientName} onChange={e => set('clientName', e.target.value)} /></div>
                <div><L>TRN</L><input className="form-input text-sm" value={f.clientTrn} onChange={e => set('clientTrn', e.target.value)} /></div>
                <div><L>File no.</L><input className="form-input text-sm" value={f.clientFileNo} onChange={e => set('clientFileNo', e.target.value)} /></div>
                <div><L>Claim reference</L><input className="form-input text-sm" value={f.clientClaimRef} onChange={e => set('clientClaimRef', e.target.value)} /></div>
              </div>
            )}
          </Section>

          <Section title="Line items" right={
            <span className="text-xs text-slate-400">Subtotal <span className="text-white font-semibold">{money(subtotal)}</span></span>
          }>
            <div className="space-y-3">
              {f.items.map((it, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">Item {i + 1}</span>
                    <button type="button" onClick={() => removeItem(i)} disabled={f.items.length <= 1} className="text-slate-500 hover:text-red-400 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="space-y-2">
                    <input className="form-input text-sm" placeholder="Description (e.g. Window Cleaning)" value={it.description} onChange={e => setItem(i, 'description', e.target.value)} />
                    <textarea className="form-input text-sm resize-none" rows={2} placeholder="Detail (optional)" value={it.detail} onChange={e => setItem(i, 'detail', e.target.value)} />
                    <input className="form-input text-sm" placeholder="Service address (optional)" value={it.serviceAddress} onChange={e => setItem(i, 'serviceAddress', e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <div><L>Date</L><input type="date" className="form-input text-sm" value={it.date} onChange={e => setItem(i, 'date', e.target.value)} /></div>
                      <div><L>Amount ($)</L><input inputMode="decimal" className="form-input text-sm" placeholder="0.00" value={it.amount} onChange={e => setItem(i, 'amount', e.target.value.replace(/[^0-9.]/g, ''))} /></div>
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addItem} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-white/15 text-slate-300 hover:border-sky-400/40 hover:text-white text-sm font-semibold cursor-pointer"><Plus className="w-4 h-4" /> Add item</button>
            </div>
          </Section>

          <Section title="Footer note">
            <input className="form-input text-sm" value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Thank you for your business." />
          </Section>

          <Section title="Payment details">
            <p className="text-xs text-slate-500 mb-2">Pick who gets paid. Fields below stay editable for one-offs.</p>
            <div className="flex flex-wrap gap-2">
              {profiles.map(p => {
                const on = activeProfileId === p.id;
                return (
                  <span key={p.id} className={`inline-flex items-center rounded-lg border text-sm font-medium ${on ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>
                    <button type="button" onClick={() => applyProfile(p)} className="pl-3 pr-2 py-2 cursor-pointer">{p.name}</button>
                    {!p.builtin && (
                      <button type="button" onClick={() => deleteProfile(p)} title="Delete profile" className="pr-2 text-slate-500 hover:text-red-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </span>
                );
              })}
              <button type="button" onClick={applyOther} className={`px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer ${isOther ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>Other</button>
              <button type="button" onClick={() => setNewProfileOpen(v => !v)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-white/15 text-slate-300 hover:text-white text-sm font-medium cursor-pointer"><Plus className="w-3.5 h-3.5" /> New profile</button>
            </div>

            {newProfileOpen && (
              <div className="mt-3 rounded-lg border border-sky-400/30 bg-sky-400/5 p-3">
                <p className="text-xs text-slate-400 mb-2">Set the account fields below, then name and save them as a reusable profile.</p>
                <div className="flex items-center gap-2">
                  <input className="form-input text-sm flex-1" placeholder="Profile name (e.g. Liam)" value={newProfileName} onChange={e => setNewProfileName(e.target.value)} />
                  <button onClick={saveNewProfile} disabled={savingProfile} className="px-3 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer whitespace-nowrap">Save profile</button>
                  <button onClick={() => { setNewProfileOpen(false); setNewProfileName(''); }} className="p-2.5 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mt-3">
              <div><L>Account name</L><input className="form-input text-sm" value={f.payAccountName} onChange={e => set('payAccountName', e.target.value)} /></div>
              <div><L>BSB</L><input className="form-input text-sm" value={f.payBsb} onChange={e => set('payBsb', e.target.value)} /></div>
              <div><L>Account no.</L><input className="form-input text-sm" value={f.payAccountNumber} onChange={e => set('payAccountNumber', e.target.value)} /></div>
            </div>
          </Section>

          <details className="rounded-xl border border-white/10 bg-navy-800 p-4">
            <summary className="text-white font-semibold text-sm cursor-pointer">Business details (from)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><L>Your name</L><input className="form-input text-sm" value={f.fromName} onChange={e => set('fromName', e.target.value)} /></div>
              <div><L>Trading as</L><input className="form-input text-sm" value={f.fromTradingAs} onChange={e => set('fromTradingAs', e.target.value)} /></div>
              <div><L>ABN</L><input className="form-input text-sm" value={f.fromAbn} onChange={e => set('fromAbn', e.target.value)} /></div>
              <div><L>Phone</L><input className="form-input text-sm" value={f.fromPhone} onChange={e => set('fromPhone', e.target.value)} /></div>
              <div className="col-span-2"><L>Address</L><input className="form-input text-sm" value={f.fromAddress} onChange={e => set('fromAddress', e.target.value)} /></div>
              <div className="col-span-2"><L>Email</L><input className="form-input text-sm" value={f.fromEmail} onChange={e => set('fromEmail', e.target.value)} /></div>
            </div>
          </details>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={save} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg cursor-pointer">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              {inv ? 'Save changes' : 'Create invoice'}
            </button>
            {inv && <button onClick={remove} className="px-4 py-3 rounded-lg border border-white/10 text-red-400 hover:border-red-400/40 cursor-pointer"><Trash2 className="w-4 h-4" /></button>}
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className={`lg:sticky lg:top-4 ${tab === 'preview' ? '' : 'hidden lg:block'}`}>
          <div className="flex items-center gap-2 mb-2 text-slate-500 text-xs"><FileText className="w-3.5 h-3.5" /> Live preview</div>
          <div className="rounded-xl overflow-hidden ring-1 ring-white/10 shadow-xl">
            <InvoicePreview invoice={previewData} />
          </div>
        </div>
      </div>

      {/* Copy-from-booking picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-sky-400" /> Copy from a booking</h3>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input autoFocus className="form-input text-sm pl-9" placeholder="Search name, phone, address…" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
              </div>
            </div>
            <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
              {bookings === null ? (
                <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
              ) : filteredBookings.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">No bookings found.</div>
              ) : filteredBookings.map(b => (
                <button key={b.id} onClick={() => applyBooking(b)} className="w-full text-left p-3 rounded-lg hover:bg-white/5 active:bg-white/10 cursor-pointer">
                  <div className="text-white text-sm font-medium">{b.name}</div>
                  <div className="text-slate-500 text-xs mt-0.5 truncate">{[serviceText(b.service), [b.address, b.suburb].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
                  {typeof b.quoteAmount === 'number' && b.quoteAmount > 0 && <div className="text-sky-400 text-xs mt-0.5">{money(b.quoteAmount)}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
