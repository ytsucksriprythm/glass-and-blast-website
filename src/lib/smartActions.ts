import { createHash } from 'node:crypto';
import {
  claimSmartAction, finishSmartAction, getBookingById, getBookings, getInvoiceById, getInvoices, getQuoteById, getQuotes, getRecurringJobs,
  getSettings, getSmartActionRecords, getSmsPreference, listLatestInvoiceReminderSms, listSms, listSmartActionSms, listSmsOptOuts, logActivity, rescheduleBookingIfAvailable, type Booking,
} from './db';
import { formatCustomerSms, invoiceReminderSms, resolveSmsTarget, sendSms, smsAutomation, smsEnabled, type SmsTarget } from './sms';
import { buildConfirmationText } from './bookingConfirmation';
import { australianMobile, smsMessageTime, type SmsMessage } from './smsTypes';
import { isLarpPhone } from './larpPhones';
import { invoiceDaysOverdue, money } from './invoice';
import { DAY, hasMarketingConsent, interpretSms, invoiceMilestone, overlapsBooking, quoteEligible } from './smartActionRules';
import { analyzeSmsThread, rankSmartActions, smartSmsIntent } from './smartActionAi';
import { sydneyToday, sydneyLocalToIso, toSydney } from './mcp/time';
import type { SmartAction, SmartActionRecord, SmartActionResult } from './smartActionTypes';

type Plan = {
  action: SmartAction;
  priority: number;
  value: number;
  target: SmsTarget;
  text?: string;
  quoteId?: string;
  move?: Parameters<typeof rescheduleBookingIfAvailable>[1] & { id: string };
  threadVersion?: string;
};
type ActionPlan = { action: SmartAction; plans: Plan[]; priority: number; value: number };
const confirmation = (job: Booking) => buildConfirmationText(job) + '\n\nReply STOP to opt out.';
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there';
const hash = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const invoiceCooldown = () => {
  const days = Number(process.env.SMART_ACTIONS_INVOICE_COOLDOWN_DAYS ?? 7);
  return Number.isInteger(days) && days > 0 ? Math.min(days, 365) : 7;
};
const activeSms = new Set(['pending', 'retry', 'sending', 'accepted', 'queued', 'sent', 'delivered', 'unknown', 'received']);
const inFlightSms = new Set(['pending', 'retry', 'sending', 'accepted', 'queued', 'unknown']);
const isControl = (body: string) => /^(STOP|STOPALL|START|UNSTOP|HELP|INFO|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(body.trim());
const phoneFor = (job?: Booking) => australianMobile(job?.phone ?? '');
const lastActivity = (sms: SmsMessage) => Math.max(Date.parse(sms.createdAt), Date.parse(smsMessageTime(sms)));
const aiCache = new Map<string, ReturnType<typeof smartSmsIntent>>();
const threadCache = new Map<string, ReturnType<typeof analyzeSmsThread>>();
const rankCache = new Map<string, ReturnType<typeof rankSmartActions>>();
const threadRows = (history: SmsMessage[]) => history.filter(row =>
  activeSms.has(row.status) && !['welcome', 'staff-alert'].includes(row.kind) && !isControl(row.body) && row.body.trim()).slice(0, 12);
const threadVersion = (rows: SmsMessage[]) => hash(rows.map(row => [row.id, row.body]));
const documentAlreadySending = (history: SmsMessage[], target: SmsTarget, requestAt: number) => history.some(row =>
  row.direction === 'outbound' && row.kind === target.kind && row.recordId === target.recordId &&
  (inFlightSms.has(row.status) || (activeSms.has(row.status) && lastActivity(row) >= requestAt)));

function cacheResult<T>(cache: Map<string, Promise<T | null>>, key: string, run: () => Promise<T | null>) {
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= 200) cache.clear();
  const result = run();
  cache.set(key, result);
  void result.then(value => {
    if (value === null) setTimeout(() => { if (cache.get(key) === result) cache.delete(key); }, 30_000).unref();
  });
  return result;
}

function intentFor(message: SmsMessage) {
  const cached = aiCache.get(message.id);
  if (cached) return cached;
  const result = smartSmsIntent(message.body, message.createdAt);
  if (aiCache.size >= 200) aiCache.clear();
  aiCache.set(message.id, result);
  return result;
}

function plan(kind: SmartAction['kind'], identity: unknown[], title: string, description: string, customer: string,
  phone: string, message: string, target: SmsTarget, priority: number, value = 0, text?: string, move?: Plan['move']): Plan {
  return { action: { id: hash(kind, ...identity), kind, title, description, recipients: [{ name: customer, phone, message }] },
    target, priority, value, text, move };
}

function manual(kind: SmartAction['kind'], identity: unknown[], title: string, description: string, customer: string,
  phone: string, text: string, priority: number, value = 0, bookingId?: string) {
  return plan(kind, identity, title, description, customer, phone, formatCustomerSms(text),
    { kind: 'manual', recordId: bookingId ?? 'phone:' + phone }, priority, value, text);
}

function fingerprint(action: SmartAction) {
  return hash(action.id, action.description, action.recipients);
}

async function generate(phoneFilter?: string, refresh = false): Promise<ActionPlan[]> {
  const now = Date.now();
  const today = sydneyToday();
  const cooldown = invoiceCooldown();
  const [jobs, invoices, quotes, recurring, messages, optedOut, reminders, settings] = await Promise.all([
    getBookings(), getInvoices(), getQuotes(), getRecurringJobs(),
    phoneFilter ? listSms(phoneFilter, false, 0, 100) : listSmartActionSms(new Date(now - 40 * DAY).toISOString()), listSmsOptOuts(), listLatestInvoiceReminderSms(), getSettings(),
  ]);
  const byInvoice = new Map(reminders.map(message => [message.recordId, message]));
  const liveJobs = jobs.filter(job => !job.id.startsWith('LARP-'));
  const byId = new Map(liveJobs.map(job => [job.id, job]));
  const byPhone = new Map<string, Booking[]>();
  const histories = new Map<string, SmsMessage[]>();
  for (const job of liveJobs) {
    const phone = phoneFor(job);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), job]);
  }
  for (const message of messages.sort((a, b) => lastActivity(b) - lastActivity(a) || b.id.localeCompare(a.id))) {
    if (message.id.startsWith('LARP-') || isLarpPhone(message.phone)) continue;
    const history = histories.get(message.phone) ?? [];
    history.push(message);
    histories.set(message.phone, history);
  }
  const plans: Plan[] = [];
  const threadCandidates = [...histories].flatMap(([phone, history]) => {
    const rows = threadRows(history);
    return australianMobile(phone) && !optedOut.has(phone) && rows.some(row => row.direction === 'inbound' &&
      Date.parse(row.createdAt) > now - 7 * DAY) ? [{ phone, rows }] : [];
  }).slice(0, 6);
  const handledThreads = new Set<string>();
  if (settings.smartActionsAiEnabled) await Promise.all(threadCandidates.map(async ({ phone, rows }) => {
    const linked = byPhone.get(phone) ?? [];
    const related = rows.find(row => row.recordId && linked.some(job => job.id === row.recordId))?.recordId;
    const latest = rows[0];
    const version = threadVersion(rows);
    const upcoming = linked.filter(job => ['confirmed', 'quote-booked'].includes(job.status) && Date.parse(job.scheduledAt ?? '') > now);
    const unscheduled = linked.filter(job => !job.scheduledAt && ['uncontacted', 'contacted', 'quoted', 'confirmed', 'quote-booked'].includes(job.status));
    const choose = (jobs: Booking[]) => jobs.find(job => job.id === related) ?? (jobs.length === 1 ? jobs[0] : undefined);
    const current = choose(upcoming);
    const cacheKey = hash(version, current?.id, current?.scheduledAt, !!choose(unscheduled));
    if (refresh) threadCache.delete(cacheKey);
    const decision = await cacheResult(threadCache, cacheKey, () => analyzeSmsThread({
      timezone: 'Australia/Sydney', existingAppointment: toSydney(current?.scheduledAt)?.label ?? null,
      today,
      hasUnscheduledBooking: !!choose(unscheduled),
      turns: [...rows].reverse().map(row => ({
        speaker: row.direction === 'inbound' ? 'customer' : 'staff',
        time: toSydney(smsMessageTime(row))?.label,
        text: row.body.slice(0, 700).replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|(?:\+61|0)4(?:[ -]?\d){8}/g, '[removed]'),
      })),
    }));
    if (!decision) return;
    handledThreads.add(phone);
    if (decision.action === 'none') return;
    const add = (item: Plan) => {
      plans.push({ ...item, threadVersion: version, action: { ...item.action, messageId: latest.id,
        customerSms: rows.find(row => row.direction === 'inbound')?.body } });
    };
    const identity = [phone, version];
    const customer = current?.name ?? choose(unscheduled)?.name ?? linked[0]?.name ?? phone;
    if (['move', 'book_job', 'book_quote'].includes(decision.action)) {
      const moving = decision.action === 'move';
      const job = moving ? current : choose(unscheduled);
      const start = sydneyLocalToIso(decision.localStart);
      if (!job || !start || Date.parse(start) <= now || start === job.scheduledAt) return;
      const status = moving ? undefined : decision.action === 'book_quote' ? 'quote-booked' : 'confirmed';
      const oldDuration = Date.parse(job.scheduledEnd ?? '') - Date.parse(job.scheduledAt ?? '');
      const end = new Date(Date.parse(start) + (oldDuration > 0 ? oldDuration : (status === 'quote-booked' ? 60 : 120) * 60_000)).toISOString();
      if (overlapsBooking(jobs, job.id, start, end)) return;
      const label = toSydney(start)?.label;
      const item = plan(moving ? 'reschedule' : 'schedule', [...identity, job.id, job.updatedAt, start, end, status],
        moving ? 'Update calendar' : 'Add to calendar', `${job.name} · ${label} · ${status === 'quote-booked' || job.status === 'quote-booked' && moving ? 'quote visit' : 'job'}`,
        job.name, phone, '', { kind: 'booking', recordId: job.id }, 1, 0, undefined,
        { id: job.id, before: job.scheduledAt ?? null, endBefore: job.scheduledEnd, updatedAt: job.updatedAt, start, end, status });
      add({ ...item, action: { ...item.action, calendarOnly: true } });
      return;
    }
    if (decision.action === 'send_invoice' || decision.action === 'send_quote') {
      const incoming = rows.find(row => row.direction === 'inbound');
      if (!incoming) return;
      const invoice = decision.action === 'send_invoice';
      const ids = new Set(linked.map(job => job.id));
      const docs = invoice
        ? invoices.filter(doc => !doc.ownerGuestId && ['sent', 'paid'].includes(doc.status) && [doc.bookingId, ...(doc.bookingIds ?? [])].some(id => id && ids.has(id)))
        : quotes.filter(doc => doc.status === 'sent' && ids.has(doc.bookingId));
      const number = decision.documentNumber.trim().toUpperCase().replace(/[ -]/g, '');
      const doc = number ? docs.find(item => item.number.toUpperCase().replace(/[ -]/g, '') === number) : docs.length === 1 ? docs[0] : undefined;
      if (doc) {
        const target: SmsTarget = { kind: invoice ? 'invoice' : 'quote', recordId: doc.id };
        if (documentAlreadySending(histories.get(phone) ?? [], target, Date.parse(incoming.createdAt))) return;
        const recipient = await resolveSmsTarget(target, true).catch(() => null);
        if (recipient?.phone === phone) {
          add(plan(invoice ? 'send-invoice' : 'send-quote', [...identity, doc.id], invoice ? 'Text invoice' : 'Text quote',
            `${customer} · Send ${doc.number} by SMS.`, customer, phone, recipient.body, target, 1));
          return;
        }
      }
      const text = `Hi, could you confirm the ${invoice ? 'invoice' : 'quote'} number or the service address so we can find the right document?`;
      add(manual('clarify', [...identity, decision.action], 'Ask which document to send', `${customer} · Confirm the requested document.`, customer, phone, text, 2));
      return;
    }
    const reply = decision.reply.trim();
    if (latest.direction === 'inbound' && reply && reply.length <= 450 && !/https?:\/\//i.test(reply)) {
      add(manual('reply', [...identity, reply], `Reply to ${customer}`, 'Send the suggested reply shown below.', customer, phone, reply, 2));
    }
  }));
  const quotePlans: Plan[] = [];
  const recentOutbound = (phone: string, days: number, quoteId?: string) => (histories.get(phone) ?? []).some(row =>
    row.direction === 'outbound' && row.kind !== 'welcome' && !(row.kind === 'quote' && row.recordId === quoteId) &&
    activeSms.has(row.status) && lastActivity(row) >= now - days * DAY);

  for (const invoice of phoneFilter || smsAutomation() ? [] : invoices) {
    const linked = [...new Set([...(invoice.bookingIds ?? []), invoice.bookingId])].flatMap(id => id && byId.has(id) ? [byId.get(id)!] : []);
    const days = invoiceDaysOverdue(invoice);
    const milestone = invoiceMilestone(invoice, linked, days);
    const phones = [...new Set(linked.map(phoneFor).filter((value): value is string => Boolean(value)))];
    const phone = phones[0];
    if (!milestone || invoice.id.startsWith('LARP-') || invoice.ownerGuestId || phones.length !== 1 || optedOut.has(phone)) continue;
    const previous = byInvoice.get(invoice.id);
    if (previous && (inFlightSms.has(previous.status) || lastActivity(previous) >= now - cooldown * DAY)) continue;
    const message = invoiceReminderSms(invoice.billToName, invoice.number, invoice.token);
    plans.push(plan('invoice', [invoice.id, invoice.dueDate, milestone],
      `${invoice.billToName} · ${money(invoice.total)} overdue`,
      `Invoice ${invoice.number} is ${days} days overdue.${previous ? ' Previous reminder ' + toSydney(smsMessageTime(previous))?.date + '.' : ''}`,
      invoice.billToName, phone, message, { kind: 'reminder', recordId: invoice.id }, 2, invoice.total));
  }

  const quotePhones = new Set<string>();
  for (const quote of phoneFilter ? [] : [...quotes].sort((a, b) => b.amount - a.amount)) {
    const job = byId.get(quote.bookingId);
    const phone = phoneFor(job);
    if (!job || !phone || optedOut.has(phone) || quotePhones.has(phone) || !quoteEligible(quote, job, today) ||
        !hasMarketingConsent(job) || recentOutbound(phone, 7, quote.id) ||
        byPhone.get(phone)?.some(other => other.id !== job.id && other.status === 'confirmed' && Date.parse(other.scheduledAt ?? '') > now)) continue;
    quotePhones.add(phone);
    const followUp = manual('quote', [quote.id, quote.sentAt], `${job.name} · ${money(quote.amount)} quote`,
      'Follow up on the unbooked quote.', job.name, phone,
      `Hi ${first(job.name)}, it’s Glass & Blast. Are you still interested in going ahead with quote ${quote.number}? We’d be happy to organise a time. Would a weekday or weekend suit you better?`,
      4, quote.amount, job.id);
    quotePlans.push({ ...followUp, quoteId: quote.id });
  }

  const inbound = [...histories.entries()].flatMap(([phone, history]) => {
    if (!australianMobile(phone) || optedOut.has(phone) || handledThreads.has(phone)) return [];
    const received = history.find(row => row.direction === 'inbound' && !isControl(row.body) && row.body.trim());
    if (!received || history.some(row => row.direction === 'outbound' && row.kind !== 'welcome' &&
      activeSms.has(row.status) && lastActivity(row) >= Date.parse(received.createdAt))) return [];
    return [{ phone, received }];
  });
  if (!settings.smartActionsAiEnabled) aiCache.clear();
  const intents = await Promise.all(inbound.map(({ received }, index) => settings.smartActionsAiEnabled && index < 6
    ? intentFor(received) : Promise.resolve(interpretSms(received.body, received.createdAt))));

  for (const [index, { phone, received }] of inbound.entries()) {
    const addReply = (item: Plan) => plans.push({
      ...item, threadVersion: threadVersion(threadRows(histories.get(phone) ?? [])),
      action: { ...item.action, customerSms: received.body, messageId: received.id },
    });
    const intent = intents[index];
    const linked = byPhone.get(phone) ?? [];
    const upcoming = linked.filter(job => ['confirmed', 'quote-booked'].includes(job.status) && Date.parse(job.scheduledAt ?? '') > now);
    const job = upcoming.find(item => item.id === received.recordId) ?? (upcoming.length === 1 ? upcoming[0] : undefined);
    const customer = job?.name ?? linked.find(item => item.id === received.recordId)?.name ?? linked[0]?.name ?? phone;
    if (intent.intent === 'reschedule' || intent.intent === 'cancel') {
      const start = intent.localStart && sydneyLocalToIso(intent.localStart);
      const before = job?.scheduledAt;
      if (intent.intent === 'reschedule' && job && before && start && Date.parse(start) > now && start !== before) {
        const duration = Date.parse(job.scheduledEnd ?? '') - Date.parse(before);
        const end = new Date(Date.parse(start) + (duration > 0 ? duration : 120 * 60_000)).toISOString();
        if (!overlapsBooking(jobs, job.id, start, end)) {
          const automated = smsAutomation();
          const item = plan('reschedule', [received.id, job.id, before, start], automated ? 'Update calendar' : `Move ${customer}’s booking`,
            automated ? `Reschedule ${customer} to ${toSydney(start)?.label}.` : `Reschedule to ${toSydney(start)?.label} and text the updated confirmation.`,
            customer, phone, automated ? '' : confirmation({ ...job, scheduledAt: start, scheduledEnd: end }),
            { kind: 'booking', recordId: job.id }, 1, 0, undefined, { id: job.id, before, endBefore: job.scheduledEnd, start, end });
          addReply(automated ? { ...item, action: { ...item.action, calendarOnly: true } } : item);
          continue;
        }
      }
      const text = intent.intent === 'cancel'
        ? `Hi ${first(customer === phone ? '' : customer)}, thanks for letting us know. Could you confirm which appointment you’d like to cancel? We’ll check it for you.`
        : `Hi ${first(customer === phone ? '' : customer)}, thanks for getting in touch about moving your booking. Could you send through your preferred date and time and an alternative that works for you?`;
      addReply(manual('clarify', [received.id, intent.intent], `Reply to ${customer} about their booking`,
        'Send a clarification reply. The appointment stays as it is.', customer, phone, text, 1));
      continue;
    }
    if (now - Date.parse(received.createdAt) < 2 * 60 * 60_000) continue;
    const text = `Hi ${first(customer === phone ? '' : customer)}, thanks for your message. We’ve received it and will get back to you as soon as we can.`;
    addReply(manual('reply', [received.id], `Reply to ${customer}`, 'Acknowledge the unanswered customer message.', customer, phone, text, 3));
  }

  if (phoneFilter) {
    const records = await getSmartActionRecords(plans.map(item => item.action.id));
    return plans.filter(item => !records.has(item.action.id)).map(item => ({
      action: item.action, plans: [item], priority: item.priority, value: item.value,
    })).sort((a, b) => a.priority - b.priority);
  }

  const recurringPhones = new Set(recurring.filter(job => job.active).map(job => australianMobile(job.phone)));
  for (const [phone, linked] of byPhone) {
    if (optedOut.has(phone)) continue;
    const upcoming = linked.filter(job => job.status === 'confirmed' && Date.parse(job.scheduledAt ?? '') > now);
    if (upcoming.length || recurringPhones.has(phone) || recentOutbound(phone, 14) ||
        linked.some(job => /\b(marketing consent withdrawn|do not contact|do not text)\b/i.test(job.adminNotes ?? ''))) continue;
    const completed = linked.filter(job => job.status === 'completed' && job.completedAt)
      .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));
    const latest = completed[0];
    const prior = latest && completed.find(job => job.id !== latest.id && job.service === latest.service &&
      job.address.trim().toLowerCase() === latest.address.trim().toLowerCase());
    if (!latest || !prior || !latest.address.trim() || !hasMarketingConsent(latest)) continue;
    const interval = Date.parse(latest.completedAt!) - Date.parse(prior.completedAt!);
    if (interval < 45 * DAY || interval > 365 * DAY || now - Date.parse(latest.completedAt!) < interval) continue;
    plans.push(manual('repeat', [latest.id, prior.id], `Check in with ${latest.name}`,
      'Their previous cleans suggest it may be time for another visit.', latest.name, phone,
      `Hi ${first(latest.name)}, it’s Glass & Blast. Would you like us to organise another clean at your property? Reply if you’d like to discuss a time.`,
      6, 0, latest.id));
  }

  const records = await getSmartActionRecords([...plans, ...quotePlans].map(item => item.action.id));
  const pending = (item: Plan) => !records.has(item.action.id);
  const eligibleQuotes = quotePlans.filter(pending).slice(0, 9);
  const ordered = plans.filter(pending).map(item => ({ action: item.action, plans: [item], priority: item.priority, value: item.value }));
  if (eligibleQuotes.length) {
    const recipients = eligibleQuotes.flatMap(item => item.action.recipients);
    const id = hash('bulk-quote', ...eligibleQuotes.map(item => item.action.id));
    if (!(await getSmartActionRecords([id])).has(id)) {
      ordered.push({
        action: { id, kind: 'quote', title: `Follow up ${recipients.length} unbooked quote${recipients.length === 1 ? '' : 's'}`,
          description: 'Review each recipient and message before sending.', recipients, bulk: true },
        plans: eligibleQuotes, priority: 4, value: eligibleQuotes[0].value,
      });
    }
  }
  return ordered.sort((a, b) => a.priority - b.priority || b.value - a.value || a.action.id.localeCompare(b.action.id));
}

export async function listSmartActions(phone?: string, refresh = false) {
  let actions = await generate(phone, refresh);
  if (!phone && actions.length > 1 && (await getSettings()).smartActionsAiEnabled) {
    const shortlist = actions.slice(0, 30);
    const signals = shortlist.map(({ action, value, priority }, index) => ({
      index, kind: action.kind, value, urgency: priority, customerRequest: Boolean(action.messageId), recipients: action.recipients.length,
    }));
    const ranking = await cacheResult(rankCache, hash(signals), () => rankSmartActions(signals));
    if (ranking) {
      const selected = new Set(ranking.order.filter(index => index >= 0 && index < shortlist.length));
      const essential = shortlist.flatMap(({ action }, index) => action.messageId && !selected.has(index) ? [index] : []);
      const order = [...essential, ...selected];
      // Requests always stay visible even if Gemini omits them.
      actions = [...order.map(index => shortlist[index]), ...actions.slice(30)];
    }
  }
  return { actions: actions.map(({ action }) => ({ ...action, preview: fingerprint(action) })), smsEnabled: smsEnabled() };
}


function state(id: string, actor: string, status: SmartActionRecord['status'], results: SmartActionResult[] = []): SmartActionRecord {
  return { id, actor, status, results, updatedAt: new Date().toISOString() };
}

function sendResult(id: string, message: SmsMessage | null | undefined): SmartActionResult {
  if (message?.sid && ['sent', 'delivered'].includes(message.status)) {
    return { id, status: 'submitted', detail: message.status === 'delivered' ? 'Delivered' : 'Sent' };
  }
  if (message && ['pending', 'retry', 'accepted', 'queued', 'sending'].includes(message.status)) {
    return { id, status: 'queued', detail: 'Queued for SMS delivery' };
  }
  return { id, status: 'failed', detail: message?.error || 'SMS delivery could not be confirmed. Check the conversation before retrying.' };
}

async function execute(plan: Plan, actor: string): Promise<SmartActionResult> {
  const { action, move, target } = plan;
  const recipient = action.recipients[0];
  if (await getSmsPreference(recipient.phone) === 'opted-out') throw new Error('This recipient has opted out.');
  if (plan.threadVersion) {
    const latest = (await listSms(recipient.phone, false, 0, 100))
      .sort((a, b) => lastActivity(b) - lastActivity(a) || b.id.localeCompare(a.id));
    if (threadVersion(threadRows(latest)) !== plan.threadVersion) throw new Error('The conversation changed. Review the latest suggestion.');
    if ((action.kind === 'send-invoice' || action.kind === 'send-quote') &&
      documentAlreadySending(latest, target, Date.parse(threadRows(latest).find(row => row.direction === 'inbound')?.createdAt ?? ''))) {
      throw new Error('This document was already sent or is being sent.');
    }
  }
  if (move) {
    const job = await getBookingById(move.id);
    if (!job || job.deletedAt || phoneFor(job) !== recipient.phone ||
        (job.scheduledAt ?? null) !== move.before || Date.parse(move.start) <= Date.now() ||
        (!action.calendarOnly && confirmation({ ...job, scheduledAt: move.start, scheduledEnd: move.end }) !== recipient.message)) {
      throw new Error('This booking changed. Review the latest suggestion.');
    }
    const saved = await rescheduleBookingIfAvailable(job.id, move);
    if (!saved) throw new Error('The booking or calendar changed. No appointment was moved.');
    await logActivity('booking.scheduled', (move.before ? 'Rescheduled' : 'Scheduled') + ' after customer SMS via Smart Actions',
      { bookingId: saved.id, scheduledAt: saved.scheduledAt, smartActionId: action.id }, actor).catch(() => {});
    if (action.calendarOnly) return { id: action.id, status: 'submitted', detail: 'Calendar updated.' };
    try {
      const result = sendResult(action.id, await sendSms(target, actor));
      return { ...result, detail: 'Booking moved. ' + result.detail };
    } catch (error) {
      return { id: action.id, status: 'failed', detail: 'Booking moved. Confirmation SMS failed: ' +
        (error instanceof Error ? error.message : 'Unknown error') };
    }
  }
  if (action.kind === 'invoice') {
    if (smsAutomation()) throw new Error('Invoice reminders are handled automatically.');
    const invoice = await getInvoiceById(target.recordId);
    const linkedIds = [...new Set([...(invoice?.bookingIds ?? []), invoice?.bookingId])].filter((id): id is string => Boolean(id));
    const [linked, reminders] = await Promise.all([
      Promise.all(linkedIds.map(getBookingById)), listLatestInvoiceReminderSms(),
    ]);
    const previous = reminders.find(row => row.recordId === target.recordId);
    if (!invoice || !invoiceMilestone(invoice, linked.filter((job): job is Booking => !!job && !job.deletedAt)) ||
      (previous && (inFlightSms.has(previous.status) || lastActivity(previous) >= Date.now() - invoiceCooldown() * DAY))) {
      throw new Error('The invoice changed or a reminder was recently sent.');
    }
  }
  if (plan.quoteId) {
    const [quote, job, history] = await Promise.all([
      getQuoteById(plan.quoteId), getBookingById(target.recordId), listSms(recipient.phone, false, 0, 100),
    ]);
    if (!quote || !job || job.deletedAt || !quoteEligible(quote, job, sydneyToday()) || !hasMarketingConsent(job) ||
      history.some(row => row.direction === 'outbound' && row.kind !== 'welcome' &&
        !(row.kind === 'quote' && row.recordId === quote.id) && activeSms.has(row.status) &&
        lastActivity(row) >= Date.now() - 7 * DAY)) {
      throw new Error('This quote is no longer eligible for an SMS follow-up.');
    }
  }
  const resolved = await resolveSmsTarget(target, true);
  if (resolved.phone !== recipient.phone || (target.kind !== 'manual' && resolved.body !== recipient.message)) {
    throw new Error('The recipient or message changed. Review the latest suggestion.');
  }
  // Key the shared outbox to the suggestion. Approval retries use the same ID,
  // and the outbox already guards pending, submitted and ambiguous sends.
  return sendResult(action.id, await sendSms({ ...target, requestId: action.id, text: plan.text, expected: { phone: recipient.phone, body: recipient.message } }, actor));
}

export async function respondToSmartAction(
  id: string, operation: 'approve' | 'dismiss', preview: string | undefined, actor: string, phone?: string,
) {
  const existing = (await getSmartActionRecords([id])).get(id);
  if (existing) return existing;
  const candidate = (await generate(phone)).find(item => item.action.id === id);
  if (!candidate) {
    if (operation === 'dismiss') return null;
    return state(id, actor, 'expired');
  }
  if (operation === 'approve' && ((!candidate.action.calendarOnly && !smsEnabled()) || fingerprint(candidate.action) !== preview)) return state(id, actor, 'expired');

  const initial = state(id, actor, operation === 'dismiss' ? 'dismissed' : 'executing');
  if (!await claimSmartAction(initial)) return (await getSmartActionRecords([id])).get(id) ?? initial;
  if (operation === 'dismiss') {
    for (const item of candidate.plans) if (item.action.id !== id) await claimSmartAction(state(item.action.id, actor, 'dismissed'));
    await logActivity('smart_action.dismissed', 'Smart Action dismissed', { smartActionId: id }, actor).catch(() => {});
    return initial;
  }

  const results: SmartActionResult[] = [];
  // Keep each recipient independent. An interrupted request leaves an
  // executing record rather than repeating an uncertain side effect.
  async function executeRecipient(item: Plan): Promise<SmartActionResult> {
    const childId = item.action.id;
    if (childId !== id && !await claimSmartAction(state(childId, actor, 'executing'))) {
      return { id: childId, status: 'skipped', detail: 'Already handled' };
    }
    let result: SmartActionResult;
    try {
      result = await execute(item, actor);
    } catch (error) {
      result = { id: childId, status: 'failed', detail: error instanceof Error ? error.message : 'Action failed.' };
    }
    if (childId !== id) await finishSmartAction(state(childId, actor, result.status === 'failed' ? 'failed' : 'completed', [result]));
    await logActivity('smart_action.result', 'Smart Action ' + result.status,
      { smartActionId: id, recipientActionId: childId, outcome: result.status }, actor,
      item.target.recordId.startsWith('phone:') ? undefined : item.target.recordId).catch(() => {});
    return result;
  }
  for (let offset = 0; offset < candidate.plans.length; offset += 3) {
    results.push(...await Promise.all(candidate.plans.slice(offset, offset + 3).map(executeRecipient)));
  }
  const finished = state(id, actor, results.some(result => result.status === 'failed') ? 'failed' : 'completed', results);
  await finishSmartAction(finished);
  return finished;
}
