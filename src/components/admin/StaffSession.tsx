'use client';

import { createContext, useContext } from 'react';
import type { StaffProfile } from '@/lib/staff';

const StaffContext = createContext<StaffProfile | null>(null);

export function StaffSession({ profile, children }: { profile: StaffProfile | null; children: React.ReactNode }) {
  return <StaffContext.Provider value={profile}>{children}</StaffContext.Provider>;
}

export function useStaffProfile() {
  return useContext(StaffContext);
}

export function readStaffPreference(profile: StaffProfile | null, key: string): string | null {
  if (!profile) return null;
  try { return localStorage.getItem('gb-crm:' + profile + ':' + key); } catch { return null; }
}

export function writeStaffPreference(profile: StaffProfile | null, key: string, value: string | null) {
  if (!profile) return;
  try {
    const storageKey = 'gb-crm:' + profile + ':' + key;
    if (value === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, value);
  } catch { /* Storage can be disabled. */ }
}
