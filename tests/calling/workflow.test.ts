import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('calling queues, reservations, outcomes and quote slots share the existing booking', async context => {
  const original = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'gb-calling-'));
  process.chdir(dir);
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) delete process.env[key];
  try {
    const db = await import('../../src/lib/db');
    const { reserveCall, releaseCall, recordCall, callingSnapshot, saveCallPolicy } = await import('../../src/lib/calling');
    const liam = { staff: 'liam', session: 'test-liam' } as const;
    const lincoln = { staff: 'lincoln', session: 'test-lincoln' } as const;
    const seed = async (name: string) => {
      await new Promise(resolve => setTimeout(resolve, 2));
      return db.addBooking({ name, phone: '0400123456', email: '', address: '', suburb: '', preferredTime: '', preferredDate: '',
        service: 'window-washing', propertyType: 'residential', notes: 'Original customer note' });
    };
    const first = await seed('One');
    const second = await seed('Two');
    const reservations = await Promise.all([reserveCall(liam), reserveCall(lincoln)]);
    assert.equal(reservations[0]?.booking.id, first.id);
    assert.equal(reservations[1]?.booking.id, second.id);
    await assert.rejects(recordCall(lincoln, { bookingId: first.id, outcome: 'no-answer', requestId: randomUUID() }, false), /reserved/);

    const retry = { bookingId: first.id, outcome: 'no-answer', requestId: randomUUID(), notes: 'Rang out' } as const;
    const miss = await recordCall(liam, retry);
    assert.equal((await recordCall(liam, retry)).id, miss.id);
    assert.ok(Date.parse(miss.nextAt!) - Date.parse(miss.at) === 24 * 3600000);
    assert.equal(await reserveCall(liam), null);
    await saveCallPolicy({ retryHours: 24, maxAttempts: 1, priority: 'new-first' });
    assert.equal((await callingSnapshot(liam)).rows.find(row => row.booking.id === first.id)?.review, true);
    assert.equal(await reserveCall(liam), null);
    await recordCall(liam, { bookingId: first.id, outcome: 'reopen', requestId: randomUUID() }, false);

    await recordCall(lincoln, { bookingId: second.id, outcome: 'answered', requestId: randomUUID(), notes: 'Wants a quote' });
    const quote = { bookingId: second.id, outcome: 'quote', requestId: randomUUID(),
      nextAt: new Date(Date.now() + 36 * 3600000).toISOString(), service: 'window-washing', assigned: 'lincoln' } as const;
    const saved = await recordCall(lincoln, quote);
    assert.equal((await recordCall(lincoln, quote)).id, saved.id);
    const appointment = await db.getBookingById(second.id);
    assert.equal(appointment?.status, 'quote-booked');
    assert.equal(appointment?.quoteStaff, 'lincoln');
    assert.equal(appointment?.notes, 'Original customer note');
    assert.match(appointment?.adminNotes ?? '', /Lincoln.*Wants a quote/);
    await assert.rejects(recordCall(liam, { ...quote, bookingId: first.id, requestId: randomUUID() }, false), /overlap/);

    const callback = await recordCall(liam, { bookingId: first.id, outcome: 'callback', requestId: randomUUID(), nextAt: quote.nextAt }, false);
    assert.equal(callback.nextAt, quote.nextAt);
    assert.equal(await reserveCall(liam), null);
    await recordCall(liam, { bookingId: first.id, outcome: 'do-not-call', requestId: randomUUID() }, false);
    await assert.rejects(recordCall(liam, { bookingId: first.id, outcome: 'callback', requestId: randomUUID(), nextAt: quote.nextAt }, false), /do not call/);
    assert.equal((await callingSnapshot(liam)).stats.lincoln.answered, 1);
    assert.equal((await callingSnapshot(liam)).stats.lincoln.quotes, 1);

    const third = await seed('Three');
    await reserveCall(liam, third.id);
    await releaseCall(liam, third.id);
    assert.equal(await reserveCall(liam, undefined, [third.id]), null);
    assert.equal((await reserveCall(lincoln, third.id))?.booking.id, third.id);
  } finally {
    process.chdir(original);
    try { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      context.diagnostic('Windows retained a handle on the temporary fixture directory.');
    }
  }
});
