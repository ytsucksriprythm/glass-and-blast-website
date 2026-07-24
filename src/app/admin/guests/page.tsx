'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Users, Trash2, Eye, X, Check, KeyRound } from 'lucide-react';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

type Guest = { id: string; name: string; active: boolean; createdAt: string };

export default function GuestsPage() {
  const router = useRouter();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState<Guest | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/guests');
        if (res.status === 401 || res.status === 403) { router.push('/admin'); return; }
        if (res.ok) setGuests(await res.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  const create = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (password.length < 4) { toast.error('Password must be at least 4 characters'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/guests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const guest: Guest = await res.json();
      setGuests(g => [...g, guest]);
      toast.success(`Guest login "${guest.name}" created`);
      setShowCreate(false); setName(''); setPassword('');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };

  // Admin -> guest view. No password needed; the admin session is kept.
  const viewAs = async (g: Guest) => {
    const res = await fetch('/api/admin/switch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: g.id }),
    });
    if (res.ok) router.push('/guest');
    else toast.error('Could not switch');
  };

  const toggleActive = async (g: Guest) => {
    const res = await fetch(`/api/admin/guests/${g.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !g.active }),
    });
    if (res.ok) {
      const updated: Guest = await res.json();
      setGuests(list => list.map(x => x.id === g.id ? updated : x));
      toast.success(updated.active ? 'Login enabled' : 'Login disabled');
    } else toast.error('Update failed');
  };

  const resetPassword = async () => {
    if (!resetFor) return;
    if (newPassword.length < 4) { toast.error('Password must be at least 4 characters'); return; }
    const res = await fetch(`/api/admin/guests/${resetFor.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) { toast.success('Password updated'); setResetFor(null); setNewPassword(''); }
    else toast.error('Update failed');
  };

  const remove = async (g: Guest) => {
    if (!window.confirm(`Delete the guest login "${g.name}"? Their jobs stay, but become unassigned. This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/guests/${g.id}`, { method: 'DELETE' });
    if (res.ok) { setGuests(list => list.filter(x => x.id !== g.id)); toast.success('Guest deleted'); }
    else toast.error('Delete failed');
  };

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="guests" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push('/admin/dashboard')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer lg:hidden">
          <ArrowLeft className="w-5 h-5" /> Dashboard
        </button>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
          <Plus className="w-4 h-4" /> Create guest login
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-400" /> Guest logins
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Subcontractors sign in with their own password and only see jobs you send them.
          </p>
        </div>

        {showCreate && (
          <div className="mb-5 rounded-xl border border-sky-400/30 bg-navy-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold text-sm">New guest login</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 text-xs mb-1">Profile name</label>
                <input className="form-input text-sm" placeholder="e.g. Dave" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">Password</label>
                <input className="form-input text-sm" placeholder="They sign in with this" value={password} onChange={e => setPassword(e.target.value)} />
                <p className="text-slate-600 text-xs mt-1">They use the normal sign-in box — no separate URL.</p>
              </div>
              <button onClick={create} disabled={saving} className="w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold cursor-pointer flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Create login
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[0, 1].map(i => <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : guests.length === 0 && !showCreate ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No guest logins yet.
            <div className="mt-4">
              <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
                <Plus className="w-4 h-4" /> Create guest login
              </button>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {guests.map(g => (
              <li key={g.id} className={`rounded-xl border p-4 ${g.active ? 'border-white/10 bg-navy-800' : 'border-white/5 bg-navy-800/50 opacity-60'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{g.name}</div>
                    <div className="text-slate-500 text-xs mt-0.5">{g.active ? 'Active' : 'Disabled'}</div>
                  </div>
                  <button onClick={() => viewAs(g)} className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-xs font-semibold cursor-pointer">
                    <Eye className="w-3.5 h-3.5" /> View as
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-4">
                  <button onClick={() => toggleActive(g)} className={`text-xs font-semibold cursor-pointer ${g.active ? 'text-slate-400 hover:text-amber-400' : 'text-emerald-400'}`}>
                    {g.active ? 'Disable login' : 'Enable login'}
                  </button>
                  <button onClick={() => { setResetFor(g); setNewPassword(''); }} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 cursor-pointer">
                    <KeyRound className="w-3.5 h-3.5" /> Reset password
                  </button>
                  <button onClick={() => remove(g)} aria-label="Delete guest" className="ml-auto text-slate-500 hover:text-red-400 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setResetFor(null)}>
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-navy-800 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Reset {resetFor.name}&apos;s password</h2>
              <button onClick={() => setResetFor(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <input autoFocus className="form-input text-sm" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <button onClick={resetPassword} className="mt-3 w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold cursor-pointer">Update password</button>
          </div>
        </div>
      )}
      </div>
      <AdminMobileNav active="guests" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="guests" items={navItems} />
    </div>
  );
}
