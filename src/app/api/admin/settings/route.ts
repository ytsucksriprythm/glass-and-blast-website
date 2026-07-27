import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings, logActivity } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import type { AppSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Read: any active session (admin or guest) — guests' own invoice editor
// needs to know things like whether Square card payments are on, without
// being able to change any of it.
export async function GET() {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getSettings());
}

// Write: master admin only.
export async function PATCH(req: NextRequest) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const b = await req.json();
  const updates: Partial<AppSettings> = {};
  const copyStr = (k: keyof AppSettings) => { if (typeof b[k] === 'string') (updates as any)[k] = b[k]; };
  const copyNum = (k: keyof AppSettings) => { if (typeof b[k] === 'number' && Number.isFinite(b[k])) (updates as any)[k] = b[k]; };
  const copyBool = (k: keyof AppSettings) => { if (typeof b[k] === 'boolean') (updates as any)[k] = b[k]; };

  (['googleReviewUrl', 'defaultJobStartTime'] as (keyof AppSettings)[]).forEach(copyStr);
  (['squareSurchargePercent', 'reviewStarThreshold', 'larpRevenueTarget'] as (keyof AppSettings)[]).forEach(copyNum);
  (['squareCardPaymentsEnabled', 'notificationsEnabled', 'notifyStatusChange', 'notifyJobAssigned',
    'notifyCustomerMarkedPaid', 'notifySquarePaid', 'notifyNewBooking', 'customerFeedbackEnabled',
    'recurringAutoBookEnabled', 'acceptingNewBookings', 'siteTrackingEnabled',
    'autofillBusinessInfo', 'autofillPaymentDetails', 'defaultShowAddressOnInvoice',
    'larpFakeNumbers', 'larpFakeBookings', 'larpFakeColdLeads', 'larpFakeInvoices', 'larpFakeCalendar',
  ] as (keyof AppSettings)[]).forEach(copyBool);

  const changedKeys = Object.keys(updates);
  const updated = await updateSettings(updates);
  if (changedKeys.length) {
    await logActivity('settings.updated', `Settings changed: ${changedKeys.join(', ')}`, { changed: changedKeys }, 'admin');
  }
  return NextResponse.json(updated);
}
