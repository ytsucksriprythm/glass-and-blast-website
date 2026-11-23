import { australianMobile, type SmsProvider } from './smsTypes';
import { claimSmsRoute, getBookings, smsRoutingSnapshot } from './db';
import { isLarpPhone } from './larpPhones';
import { smsEstimate } from './dataFlowsSms';

export async function smsMigrationReport(backfill = false) {
  const [{ routes, messages }, bookings] = await Promise.all([smsRoutingSnapshot(), getBookings()]);
  const legacy = new Map<string, string>();
  const contacts = new Map<string, string>();
  const hasHistory = new Set<string>();
  for (const booking of bookings) {
    const phone = australianMobile(booking.phone);
    if (phone && !booking.id.startsWith('LARP-') && !isLarpPhone(phone)) contacts.set(phone, booking.id);
  }
  for (const row of messages) {
    const phone = australianMobile(row.phone);
    if (!phone || isLarpPhone(phone) || row.id.startsWith('LARP-') || row.kind === 'staff-alert') continue;
    hasHistory.add(phone);
    if ((row.provider ?? 'twilio') === 'twilio' && (!legacy.has(phone) || row.createdAt > legacy.get(phone)!)) {
      legacy.set(phone, row.createdAt);
    }
  }
  const existing = new Map(routes.map(route => [route.phone, route]));
  let backfilled = 0;
  if (backfill) {
    const senderNumber = australianMobile(process.env.TWILIO_SMS_FROM ?? '');
    if (!senderNumber) throw new Error('Configure the historical Twilio sender first.');
    for (const [phone, lastInteraction] of legacy) {
      if (existing.has(phone)) continue;
      const route = await claimSmsRoute({ phone, provider: 'twilio', senderNumber, customerId: contacts.get(phone) ?? null,
        firstInteraction: lastInteraction, lastInteraction, locked: true, migrationStatus: 'legacy' }, senderNumber);
      existing.set(phone, route);
      backfilled++;
    }
  }
  function providerStats(provider: SmsProvider) {
    const outbound = messages.filter(row => !row.id.startsWith('LARP-') && !isLarpPhone(row.phone) &&
      (row.provider ?? 'twilio') === provider && row.direction === 'outbound');
    const submitted = outbound.filter(row => row.sid);
    const priced = submitted.filter(row => row.estimatedCostAud !== undefined);
    return {
      assigned: [...existing.values()].filter(route => route.provider === provider).length,
      submitted: submitted.length, segments: submitted.reduce((sum, row) => sum + (row.segments ?? smsEstimate(row.body).segments), 0),
      failed: outbound.filter(row => ['failed', 'undelivered', 'unknown'].includes(row.status)).length,
      pending: outbound.filter(row => ['pending', 'retry', 'sending', 'accepted', 'queued'].includes(row.status)).length,
      estimatedCostAud: priced.length ? priced.reduce((sum, row) => sum + row.estimatedCostAud!, 0) : null,
      unpriced: submitted.length - priced.length,
    };
  }
  const reviewRoutes = [...existing.values()].filter(route => route.migrationStatus === 'review');
  return { legacyTwilio: legacy.size, withoutHistory: [...contacts.keys()].filter(phone => !hasHistory.has(phone)).length,
    alreadyAssigned: existing.size, backfilled, review: reviewRoutes.length,
    reviewRoutes: reviewRoutes.slice(0, 25).map(({ phone, provider, senderNumber }) => ({ phone, provider, senderNumber })),
    twilio: providerStats('twilio'), dataflows: providerStats('dataflows') };
}
