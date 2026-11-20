'use client';

import { STAFF_PROFILES, type StaffProfile } from '@/lib/staff';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Lock, Eye, EyeOff, Check, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

function signedInDestination() {
  const booking = new URLSearchParams(window.location.search).get('booking');
  return booking && /^[a-zA-Z0-9_-]+$/.test(booking) ? '/admin/bookings/' + booking : '/admin/dashboard';
}

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chooseProfile, setChooseProfile] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/login", { signal: controller.signal }).then(response => response.json()).then(session => {
      if (controller.signal.aborted) return;
      if (session.role === "admin") router.replace(signedInDestination());
      else if (session.role === "choose-profile") setChooseProfile(true);
    }).catch(() => {});
    return () => controller.abort();
  }, [router]);

  const selectProfile = async (profile: StaffProfile) => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
      if (!response.ok) { setChooseProfile(false); toast.error('Enter your password again'); return; }
      router.replace(signedInDestination());
      router.refresh();
    } catch { toast.error('Could not sign in. Try again.'); } finally { setLoading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, remember }),
      });
      if (!res.ok) { toast.error('Incorrect password'); setLoading(false); return; }
      // The same box accepts the admin password or any guest's password.
      const { role } = await res.json();
      if (role === 'guest') router.replace('/guest');
      else { setPassword(''); setChooseProfile(true); setLoading(false); }
    } catch {
      toast.error('Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div
      className="crm-login min-h-[100svh] bg-navy-900 flex flex-col items-center justify-center px-6 py-6 overflow-y-auto"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.5rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Image src="/icon-192.png" alt="" width={64} height={64} className="mx-auto size-16 rounded-2xl border border-white/10" priority />
          <h1 className="mt-5 text-3xl font-bold text-white">Glass &amp; Blast CRM</h1>
        </div>

        {chooseProfile ? (
          <section className="crm-panel space-y-3 p-5 sm:p-6">
            <h2 className="font-semibold text-white">Who is signing in?</h2>
            {(Object.keys(STAFF_PROFILES) as StaffProfile[]).map(profile => (
              <button key={profile} type="button" disabled={loading} onClick={() => void selectProfile(profile)} className="crm-profile-option"><span className="crm-profile-avatar" aria-hidden="true">{STAFF_PROFILES[profile][0]}</span><span className="flex-1">{STAFF_PROFILES[profile]}</span><ArrowRight className="size-4 text-sky-300" /></button>
            ))}
            <button type="button" disabled={loading} onClick={() => setChooseProfile(false)} className="min-h-11 text-sm text-slate-300">Back to password</button>
          </section>
        ) : <form onSubmit={submit} className="crm-panel space-y-4 p-5 sm:p-6">
          {/* Hidden username so iOS Keychain saves + offers Face ID autofill against this login */}
          <input
            type="text"
            name="username"
            value="Glass & Blast Admin"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
          />

          <div>
            <label htmlFor="password" className="block text-slate-400 text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                id="password"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                className="form-input pl-11 pr-11 text-base"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRemember(r => !r)}
            className="flex items-center gap-2.5 text-sm cursor-pointer"
          >
            <span className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${remember ? 'bg-sky-500 border-sky-500' : 'border-white/25'}`}>
              {remember && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </span>
            <span className="text-slate-300">Keep me signed in</span>
          </button>

          <button
            type="submit"
            disabled={!password || loading}
            className="w-full min-h-[48px] py-3.5 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in</>
              : 'Sign in'}
          </button>

          <p className="text-slate-600 text-xs leading-relaxed pt-1">
            Save this password on your iPhone to use Face ID autofill next time.
          </p>
        </form>}

        <p className="text-center text-slate-600 text-xs mt-6">
          <a href="/" className="hover:text-sky-400 transition-colors">Back to website</a>
        </p>
      </div>
    </div>
  );
}
