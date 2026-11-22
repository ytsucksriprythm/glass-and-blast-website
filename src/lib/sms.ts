import { buildConfirmationText } from './bookingConfirmation';
import { syncBookingStatusToSheet } from './metaLeads';
﻿import { createHash } from 'node:crypto';
import twilio from 'twilio';
import {
  changeSms, contactUncontactedBooking, getBookingById, getBookings, getInvoiceById, getInvoicesForBooking, getQuoteById, getSms, getSmsPreference, hasSubmittedCustomerSms,
  insertSms, listChatgptSmsReads, listLatestCustomerSms, listPendingCustomerSms, listSms, listSmsReadStates, listSmsWork, logActivity, setSmsPreference,
} from './db';
import { australianMobile, smsPhone, smsReadReceipts, type SmsConversation, type SmsKind, type SmsMessage } from './smsTypes';
import type { StaffProfile } from './staff';
import { sydneyDay } from './callingTypes';

export type SmsTarget = { kind: Exclude<SmsKind, 'reply' | 'staff-alert' | 'welcome'>; recordId: string };
type SendInput = SmsTarget & { requestId?: string; text?: string; automatic?: boolean; reminderNumber?: number };
export class SmsError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const base = () => (process.env.TWILIO_SMS_PUBLIC_URL || process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au').replace(/\/$/, '');
const dayMs = 86400000;
const name = (value: string) => value.trim().split(/\s+/)[0] || 'there';
const brand = (text: string) => ['Glass & Blast', text, 'Reply STOP to opt out.'].join('\n\n');
const key = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const states = new Set(['queued', 'accepted', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'canceled']);
const terminal = new Set(['delivered', 'undelivered', 'failed', 'canceled']);

export function smsConfigured() {
  try {
    const url = new URL(base());
    return url.protocol === 'https:' && url.origin === base() &&
      !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
  } catch { return false; }
}
export function smsEnabled() { return smsConfigured() && process.env.TWILIO_SMS_ENABLED === 'true'; }
export function smsAutomation() { return smsEnabled() && process.env.TWILIO_SMS_AUTOMATION === 'true'; }
function client() {
  if (!smsConfigured()) throw new SmsError('Twilio sender is not configured.', 503);
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { timeout: 10000 });
}

async function isMetaQuoteRequest(bookingId: string, phone: string) {
  const booking = await getBookingById(bookingId);
  return booking?.source === 'facebook-lead-ad' && !booking.deletedAt && australianMobile(booking.phone) === phone;
}

export async function resolveSmsTarget(target: SmsTarget, forSend = false, automatic = false) {
  const { recordId, kind } = target;
  if (kind === 'manual' && recordId.startsWith('phone:')) {
    const phone = smsPhone(recordId.slice(6));
    if (!phone) throw new SmsError('Invalid SMS number.', 400);
    if (forSend && !australianMobile(phone)) throw new SmsError('Sending is available for Australian mobiles only.');
    return { phone, version: phone, body: '' };
  }
  if (kind === 'invoice' || kind === 'reminder') {
    const invoice = await getInvoiceById(recordId);
    if (!invoice || invoice.ownerGuestId) throw new SmsError('Invoice not found.', 404);
    const linked = await Promise.all([...new Set([...(invoice.bookingIds ?? []), invoice.bookingId].filter(Boolean) as string[])].map(getBookingById));
    const jobs = linked.filter(job => job && !job.deletedAt);
    const phones = [...new Set(jobs.flatMap(job => australianMobile(job!.phone ?? '') ?? []))];
    if (phones.length !== 1) throw new SmsError('Link the invoice to a booking with one unambiguous Australian mobile number.');
    const overdue = invoice.dueDate && invoice.dueDate < sydneyDay(Date.now());
    const isReceipt = kind === 'invoice' && invoice.status === 'paid';
    const unpaidInvoice = invoice.status === 'sent' && !invoice.squarePaidAt && !jobs.every(job => job!.paid);
    if (forSend && !unpaidInvoice && !(isReceipt && !automatic)) {
      throw new SmsError('This invoice is not ready for SMS or has already been paid.');
    }
    if (forSend && kind === 'reminder' && !overdue) throw new SmsError('The invoice is not overdue.');
    const url = base() + '/invoice/' + encodeURIComponent(invoice.token);
    return { phone: phones[0], version: isReceipt ? [invoice.token, 'paid'] : invoice.token, completed: jobs.some(job => job!.status === 'completed'),
      dueDate: invoice.dueDate, body: brand(kind === 'invoice'
        ? 'Hi ' + name(invoice.billToName) + ', ' + (isReceipt
          ? 'thanks for your payment. View your receipt for invoice ' + invoice.number + ': '
          : 'invoice ' + invoice.number + ' is ready: ') + url
        : 'Hi ' + name(invoice.billToName) + ', invoice ' + invoice.number + ' is overdue. View or pay: ' + url) };
  }
  const quote = kind === 'quote' ? await getQuoteById(recordId) : null;
  if (kind === 'quote' && !quote) throw new SmsError('Quote not found.', 404);
  const job = await getBookingById(quote?.bookingId ?? recordId);
  if (!job || job.deletedAt) throw new SmsError('Booking not found.', 404);
  const phone = australianMobile(job.phone ?? '');
  if (!phone) throw new SmsError('The booking needs a valid Australian mobile number.');
  const first = name(job.name);
  if (quote) {
    if (forSend && quote.status !== 'sent') throw new SmsError('Approve the quote by marking it sent first.');
    return { phone, version: quote.token, body: brand('Hi ' + first + ', your quote ' + quote.number + ' is ready: ' + base() + '/quote/' + encodeURIComponent(quote.token)) };
  }
  if (kind === 'manual') return { phone, version: job.id, body: '' };
  if (forSend && (!job.scheduledAt || !['confirmed', 'quote-booked'].includes(job.status) || Date.parse(job.scheduledAt) <= Date.now())) throw new SmsError('Confirm and schedule a future appointment first.');
  return { phone, version: [job.scheduledAt, job.status],
    body: job.scheduledAt ? buildConfirmationText(job) + '\n\nReply STOP to opt out.' : '' };
}

async function updateResult(id: string, sid: string | undefined, status: string, error?: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await getSms(id);
    if (!row || row.direction !== 'outbound' || (row.sid && sid && row.sid !== sid)) return;
    if (terminal.has(row.status) && row.status !== status) return;
    const order = ['accepted', 'queued', 'sending', 'sent', 'delivered'];
    if (order.includes(status) && order.indexOf(status) < order.indexOf(row.status) && row.sid) return;
    if (await changeSms(row, { sid: sid ?? row.sid, status, error })) return;
  }
}

export async function dispatchSms(id: string) {
  if (!smsEnabled()) return getSms(id);
  const row = await getSms(id);
  if (!row || (row.status !== 'pending' && !(row.status === 'retry' && (row.retryAt ?? '') <= new Date().toISOString()))) return row;
  if (row.automatic && !smsAutomation()) return row;
  if (row.automatic && row.createdAt < new Date(Date.now() - dayMs).toISOString()) {
    await changeSms(row, { status: 'canceled', error: 'Automated message expired before sending.' });
    return getSms(id);
  }
  if (row.kind !== 'reply' && row.kind !== 'staff-alert' && row.kind !== 'welcome' && row.recordId) {
    try {
      const current = await resolveSmsTarget({ kind: row.kind, recordId: row.recordId }, true, row.automatic);
      if (current.phone !== row.phone || (row.kind !== 'manual' && current.body !== row.body) || (row.automatic && row.kind === 'invoice' && !current.completed)) {
        throw new SmsError('The booking or document changed before dispatch.');
      }
    } catch (error) {
      if (!(error instanceof SmsError)) throw error;
      await changeSms(row, { status: 'canceled', error: error.message });
      return getSms(id);
    }
  }
  const canSend = async () => {
    const preference = await getSmsPreference(row.phone);
    if (preference === 'opted-out') return false;
    if (row.kind === 'staff-alert') return staffAlertRecipients().includes(row.phone);
    return preference === 'opted-in' || Boolean(row.quoteRequestBookingId &&
      await isMetaQuoteRequest(row.quoteRequestBookingId, row.phone));
  };
  if (!await canSend()) {
    await changeSms(row, { status: 'canceled', error: 'SMS consent is missing or was withdrawn.' });
    return getSms(id);
  }
  if (row.kind !== 'welcome' && row.kind !== 'staff-alert' && !await hasSubmittedCustomerSms(row.phone)) {
    const welcomeId = key('sms-welcome', row.phone);
    const now = new Date().toISOString();
    await insertSms({ id: welcomeId, kind: 'welcome', phone: row.phone, recordId: null,
      body: brand('We use this number to text you about your quotes, bookings and invoices. You can reply here to reach our team. This line does not accept calls. If you’d prefer to speak with us, please call Lincoln on 0466 050 834.'),
      direction: 'outbound', status: 'pending', actor: row.actor, createdAt: now, updatedAt: now,
      quoteRequestBookingId: row.quoteRequestBookingId });
    const existing = await getSms(welcomeId);
    if (existing?.status === 'canceled' && !existing.sid) {
      await changeSms(existing, { status: 'pending', error: undefined, quoteRequestBookingId: row.quoteRequestBookingId });
    }
    const welcome = await dispatchSms(welcomeId);
    if (welcome?.status !== 'delivered') {
      if (welcome && ['failed', 'undelivered', 'canceled'].includes(welcome.status)) {
        await changeSms(row, { status: 'failed', error: 'The first SMS notice could not be sent. ' + (welcome.error ?? '') });
      }
      return getSms(id);
    }
  }
  if (!await changeSms(row, { status: 'sending', submittedAt: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })) return getSms(id);
  if (!await canSend()) {
    await updateResult(id, undefined, 'canceled', 'SMS consent was withdrawn.');
    return getSms(id);
  }
  try {
    const result = await client().messages.create({
      from: process.env.TWILIO_SMS_FROM!, to: row.phone, body: row.body,
      statusCallback: base() + '/api/webhooks/twilio/status?id=' + encodeURIComponent(id),
    });
    await updateResult(id, result.sid, result.status, result.errorCode ? 'Twilio ' + result.errorCode : undefined);
    await logActivity('sms.submitted', 'SMS ' + row.kind + ' submitted to Twilio', { smsId: id, recordId: row.recordId }, row.actor).catch(() => {});
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : null;
    const statusCode = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
    if (code === 21610) await setSmsPreference(row.phone, 'opted-out', 'Twilio');
    const latest = await getSms(id);
    if (latest && !latest.sid && latest.status === 'sending') {
      const retry = statusCode === 429 && (latest.attempts ?? 0) < 3;
      // A timeout or 5xx can mean Twilio accepted the request. Leave it for callback or manual reconciliation.
      await changeSms(latest, { status: retry ? 'retry' : statusCode >= 400 && statusCode < 500 ? 'failed' : 'unknown',
        error: code ? 'Twilio ' + code : 'No confirmed response from Twilio.',
        retryAt: retry ? new Date(Date.now() + 300000 * (latest.attempts ?? 1)).toISOString() : undefined });
    }
  }
  return getSms(id);
}

export async function sendSms(input: SendInput, actor: string) {
  if (!smsEnabled() || (input.automatic && !smsAutomation())) throw new SmsError('Customer SMS sending is disabled.', 503);
  const target = await resolveSmsTarget(input, true, input.automatic);
  if (input.automatic && input.kind === 'invoice' && !target.completed) return null;
  const body = input.kind === 'manual' ? brand(input.text?.trim() ?? '') : target.body;
  if (input.kind === 'manual' && !input.text?.trim()) throw new SmsError('Enter a message first.', 400);
  const preference = await getSmsPreference(target.phone);
  if (preference === 'opted-out') throw new SmsError('This number opted out. The customer must text START to opt back in.');
  const quoteRequestBookingId = preference === null && !input.automatic && input.kind === 'manual' &&
    !input.recordId.startsWith('phone:') && await isMetaQuoteRequest(input.recordId, target.phone) ? input.recordId : undefined;
  if (preference !== 'opted-in' && !quoteRequestBookingId) throw new SmsError('Record customer consent before sending SMS.');
  const id = !input.requestId && input.kind === 'reminder'
    ? key(input.kind, input.recordId, input.reminderNumber ?? 1)
    : input.requestId ? key(input.kind, input.recordId, input.requestId) : key(input.kind, input.recordId, target.version);
  if (input.requestId && input.kind !== 'manual' && !await getSms(id)) {
    const previous = await listSms(target.phone);
    if (previous.some(row => row.kind === input.kind && row.recordId === input.recordId &&
      ['pending', 'retry', 'sending', 'accepted', 'queued', 'unknown'].includes(row.status))) {
      throw new SmsError('The previous SMS is still pending or its status is unknown. Check delivery before resending.');
    }
  }
  if (!input.automatic) {
    const welcome = await getSms(key('sms-welcome', target.phone));
    if (welcome?.status === 'failed' && !welcome.sid) {
      await changeSms(welcome, { status: 'pending', error: undefined });
      const previous = await getSms(id);
      if (previous?.status === 'failed' && !previous.sid && previous.error?.startsWith('The first SMS notice could not be sent.')) {
        await changeSms(previous, { status: 'pending', error: undefined });
      }
    }
  }
  const now = new Date().toISOString();
  const recordId = input.kind === 'manual' && input.recordId.startsWith('phone:')
    ? (await matchReplyBooking(target.phone))?.id ?? null : input.recordId;
  await insertSms({ id, kind: input.kind, recordId, phone: target.phone, body, direction: 'outbound',
    status: 'pending', actor, automatic: input.automatic, quoteRequestBookingId, createdAt: now, updatedAt: now });
  return dispatchSms(id);
}

export async function automaticSms(kind: 'quote' | 'invoice' | 'booking', recordId: string) {
  if (!smsAutomation()) return;
  try { await sendSms({ kind, recordId, automatic: true }, 'system'); }
  catch (error) {
    if (!(error instanceof SmsError)) console.error('SMS automation could not queue', kind);
  }
}

export async function completedBookingSms(bookingId: string) {
  if (!smsAutomation()) return;
  for (const invoice of await getInvoicesForBooking(bookingId)) {
    if (invoice.status === 'sent') await automaticSms('invoice', invoice.id);
  }
}

export function verifyTwilio(signature: string, route: string, fields: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  return !!(token && signature && fields.AccountSid === process.env.TWILIO_ACCOUNT_SID &&
    twilio.validateRequest(token, signature, base() + route, fields));
}

function staffAlertRecipients() {
  return [...new Set((process.env.TWILIO_SMS_STAFF_ALERT_RECIPIENTS ?? '').split(',')
    .map(australianMobile).filter((phone): phone is string => phone !== null))];
}

async function matchReplyBooking(phone: string) {
  const [bookings, history] = await Promise.all([getBookings(), listSms(phone)]);
  const matches = bookings.filter(booking => smsPhone(booking.phone ?? '') === phone);
  if (matches.length < 2) return matches[0];
  for (const message of history) {
    if (message.direction !== 'outbound' || !message.recordId || message.kind === 'staff-alert' ||
      !['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(message.status)) continue;
    if (message.kind === 'quote') {
      const quote = await getQuoteById(message.recordId);
      const match = matches.find(booking => booking.id === quote?.bookingId);
      if (match) return match;
    } else if (message.kind === 'invoice' || message.kind === 'reminder') {
      const invoice = await getInvoiceById(message.recordId);
      const linked = new Set([invoice?.bookingId, ...(invoice?.bookingIds ?? [])]);
      const match = matches.find(booking => linked.has(booking.id));
      if (match) return match;
    } else {
      const match = matches.find(booking => booking.id === message.recordId);
      if (match) return match;
    }
  }
  return matches[0];
}

async function alertStaffOfReply(reply: SmsMessage, customerName: string | undefined, recipients: string[]) {
  const link = reply.recordId ? base() + '/admin/bookings/' + encodeURIComponent(reply.recordId) : null;
  const body = [
    'Glass & Blast · New SMS',
    'From ' + (customerName ? customerName + ' (' + reply.phone + ')' : reply.phone),
    reply.body.slice(0, 1000) || '(No text body)',
    link ? 'Booking ' + reply.recordId + ': ' + link : 'No matching booking.',
  ].join('\n\n');
  const ids = await Promise.all(recipients.map(async phone => {
    const id = key('staff-alert', reply.id, phone);
    await insertSms({ id, kind: 'staff-alert', recordId: reply.recordId, phone, body, direction: 'outbound',
      status: 'pending', actor: 'system', createdAt: reply.createdAt, updatedAt: reply.createdAt });
    return id;
  }));
  await Promise.all(ids.map(dispatchSms));
}

export async function receiveSms(fields: Record<string, string>, notifyStaff = false) {
  const phone = smsPhone(fields.From ?? '');
  const sid = fields.MessageSid;
  if (!phone || !/^SM[a-fA-F0-9]{32}$/.test(sid ?? '') || fields.To !== process.env.TWILIO_SMS_FROM) return;
  const event = fields.OptOutType || fields.Body?.trim().toUpperCase();
  const id = key('incoming', sid);
  // A replay of an old START must not undo a more recent STOP.
  if (await getSms(id)) return;
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(event)) {
    await setSmsPreference(phone, 'opted-out', 'Twilio');
  }
  const recipients = notifyStaff && smsEnabled() ? staffAlertRecipients() : [];
  const booking = await matchReplyBooking(phone);
  const isCustomerReply = Boolean(fields.Body?.trim() || Number(fields.NumMedia) > 0) && !fields.OptOutType &&
    !['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'START', 'UNSTOP', 'HELP', 'INFO'].includes(event);
  if (isCustomerReply && booking?.status === 'uncontacted') {
    const contacted = await contactUncontactedBooking(booking.id);
    if (contacted) await syncBookingStatusToSheet(contacted).catch(error => {
      console.error('Could not sync SMS contact status', error instanceof Error ? error.name : 'Unknown error');
    });
  }
  const now = new Date().toISOString();
  const reply: SmsMessage = { id, sid, kind: 'reply', recordId: booking?.id ?? null, phone, body: fields.Body ?? '',
    direction: 'inbound', status: 'received', actor: 'customer', createdAt: now, updatedAt: now };
  const inserted = await insertSms(reply);
  if (inserted && ['START', 'UNSTOP'].includes(event)) await setSmsPreference(phone, 'opted-in', 'Twilio', true);
  if (inserted && recipients.length) await alertStaffOfReply(reply, booking?.name, recipients).catch(error => {
    console.error('Could not queue staff SMS alerts', error instanceof Error ? error.name : 'Unknown error');
  });
}

export async function receiveSmsStatus(id: string, fields: Record<string, string>) {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^SM[a-fA-F0-9]{32}$/.test(fields.MessageSid ?? '') || !states.has(fields.MessageStatus)) return;
  const row = await getSms(id);
  if (!row || row.phone !== australianMobile(fields.To ?? '') || fields.From !== process.env.TWILIO_SMS_FROM) return;
  await updateResult(id, fields.MessageSid, fields.MessageStatus, fields.ErrorCode ? 'Twilio ' + fields.ErrorCode : undefined);
  if (row.kind === 'welcome' && terminal.has(fields.MessageStatus)) {
    const updated = await getSms(id);
    if (updated?.sid === fields.MessageSid && updated.status === fields.MessageStatus) {
      await releaseMessagesAfterWelcome(row.phone);
    }
  }
}

async function releaseMessagesAfterWelcome(phone: string) {
  for (const item of await listPendingCustomerSms(phone)) await dispatchSms(item.id);
}

export async function runSmsCron() {
  if (!smsEnabled()) return { enabled: false };
  const work = await listSmsWork('pending');
  const bounded = async <T,>(items: T[], fn: (item: T) => Promise<unknown>) => {
    for (let offset = 0; offset < items.length; offset += 4) {
      await Promise.allSettled(items.slice(offset, offset + 4).map(fn));
    }
  };
  await bounded(work.slice(0, 8), item => dispatchSms(item.id));
  const poll = await listSmsWork('accepted');
  await bounded(poll.slice(0, 8), async item => {
    try {
      const message = await client().messages(item.sid!).fetch();
      await updateResult(item.id, message.sid, message.status, message.errorCode ? 'Twilio ' + message.errorCode : undefined);
      if (item.kind === 'welcome' && terminal.has(message.status)) await releaseMessagesAfterWelcome(item.phone);
    } catch { /* Status callbacks or a later poll can reconcile the message. */ }
  });
  if (!smsAutomation()) return { enabled: true, checked: work.length };
  const due: { recordId: string; number: number }[] = [];
  for (const item of await listSmsWork('invoice')) {
    if (due.length >= 4) break;
    if (!item.recordId) continue;
    try {
      const target = await resolveSmsTarget({ kind: 'reminder', recordId: item.recordId }, true);
      const age = (Date.parse(sydneyDay(Date.now())) - Date.parse(target.dueDate ?? '')) / dayMs;
      if (!Number.isFinite(age) || age < 3 || target.phone !== item.phone || await getSmsPreference(item.phone) !== 'opted-in') continue;
      const first = await getSms(key('reminder', item.recordId, 1));
      const number = !first ? 1 : age >= 7 && ['sent', 'delivered'].includes(first.status) &&
        Date.now() - Date.parse(first.createdAt) >= 4 * dayMs ? 2 : 0;
      if (!number || (number === 2 && await getSms(key('reminder', item.recordId, 2)))) continue;
      due.push({ recordId: item.recordId, number });
    } catch { /* Paid, canceled, and incomplete invoices leave the reminder queue. */ }
  }
  await bounded(due, item => sendSms({ kind: 'reminder', recordId: item.recordId, automatic: true, reminderNumber: item.number }, 'system'));
  return { enabled: true, remindersChecked: due.length, checked: work.length };
}

export async function listSmsConversations(incomingOnly = false, profile?: StaffProfile) {
  const latest = listLatestCustomerSms(incomingOnly);
  const latestIncoming = profile ? (incomingOnly ? latest : listLatestCustomerSms(true)) : Promise.resolve([]);
  const [bookings, messages, incoming, states, chatgpt] = await Promise.all([
    getBookings(), latest, latestIncoming,
    profile ? listSmsReadStates() : null,
    latestIncoming.then(rows => listChatgptSmsReads(rows.map(row => row.id))),
  ]);
  const incomingPhones = new Set(incomingOnly ? messages.map(message => message.phone) : []);
  const conversations = new Map<string, SmsConversation>();
  for (const booking of bookings) {
    const phone = smsPhone(booking.phone ?? '');
    if (!phone || (incomingOnly && !incomingPhones.has(phone))) continue;
    const conversation = conversations.get(phone) ?? { phone, jobs: [] };
    conversation.jobs.push({
      id: booking.id, name: booking.name, address: [booking.address, booking.suburb].filter(Boolean).join(', '),
      status: booking.status, scheduledAt: booking.scheduledAt,
    });
    conversations.set(phone, conversation);
  }
  for (const { phone, id, body, direction, createdAt } of messages) {
    if (!smsPhone(phone)) continue;
    conversations.set(phone, { ...conversations.get(phone), phone, jobs: conversations.get(phone)?.jobs ?? [],
      latest: { id, body, direction, createdAt } });
  }
  if (profile) for (const message of incoming) {
    const conversation = conversations.get(message.phone);
    if (!conversation) continue;
    const receipts = smsReadReceipts(states?.[message.phone], chatgpt[message.id], message);
    conversation.unread = !receipts.some(receipt => receipt.profile === profile);
    conversation.latestIncomingReceipts = receipts;
  }
  return [...conversations.values()].sort((a, b) =>
    (b.latest?.createdAt ?? '').localeCompare(a.latest?.createdAt ?? '') ||
    (a.jobs[0]?.name ?? a.phone).localeCompare(b.jobs[0]?.name ?? b.phone));
}
