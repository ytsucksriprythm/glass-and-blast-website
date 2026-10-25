import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings, logActivity } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import type { AppSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const clampPercent = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

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

  (['googleReviewUrl', 'defaultJobStartTime', 'contractExtraTerms'] as (keyof AppSettings)[]).forEach(copyStr);
  (['squareSurchargePercent', 'reviewStarThreshold', 'larpRevenueTarget', 'contractTermMonths', 'contractCancelFeePercent', 'contractCoolingOffDays', 'packageEssentialPercent', 'packagePremiumPercent'] as (keyof AppSettings)[]).forEach(copyNum);
  (['squareCardPaymentsEnabled', 'notificationsEnabled', 'notifyNewBooking', 'customerFeedbackEnabled',
    'recurringAutoBookEnabled', 'contractFeeFirstTermOnly', 'acceptingNewBookings', 'siteTrackingEnabled',
    'autofillBusinessInfo', 'autofillPaymentDetails', 'defaultShowAddressOnInvoice',
    'larpFakeNumbers', 'larpFakeBookings', 'larpFakeColdLeads', 'larpFakeInvoices', 'larpFakeCalendar',
  ] as (keyof AppSettings)[]).forEach(copyBool);

  // Contract numbers: whole months/days, a sane percentage.
  if (updates.contractTermMonths !== undefined) updates.contractTermMonths = Math.min(60, Math.max(1, Math.round(updates.contractTermMonths)));
  if (updates.contractCancelFeePercent !== undefined) updates.contractCancelFeePercent = Math.min(100, Math.max(0, updates.contractCancelFeePercent));
  if (updates.contractCoolingOffDays !== undefined) updates.contractCoolingOffDays = Math.min(30, Math.max(0, Math.round(updates.contractCoolingOffDays)));

  // Package tiers: whole percents. Essential is a discount (1-100% of
  // Complete), Premium Detail an increase (100-500%).
  if (updates.packageEssentialPercent !== undefined) updates.packageEssentialPercent = clampPercent(updates.packageEssentialPercent, 1, 100);
  if (updates.packagePremiumPercent !== undefined) updates.packagePremiumPercent = clampPercent(updates.packagePremiumPercent, 100, 500);

  const changedKeys = Object.keys(updates);
  const updated = await updateSettings(updates);
  if (changedKeys.length) {
    await logActivity('settings.updated', `Settings changed: ${changedKeys.join(', ')}`, { changed: changedKeys }, 'admin');
  }
  return NextResponse.json(updated);
}
