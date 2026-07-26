import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { deleteBookingsByIdPrefix, deleteInvoicesByIdPrefix, deleteRecurringByIdPrefix, updateSettings, logActivity } from '@/lib/db';
import { LARP_ID_PREFIX } from '@/lib/larp';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [bookings, invoices, recurring] = await Promise.all([
    deleteBookingsByIdPrefix(LARP_ID_PREFIX),
    deleteInvoicesByIdPrefix(LARP_ID_PREFIX),
    deleteRecurringByIdPrefix(LARP_ID_PREFIX),
  ]);
  await updateSettings({ larpModeActive: false });
  await logActivity(
    'larp.stopped',
    `LARP mode off — ${bookings} fake jobs, ${invoices} fake invoices, ${recurring} fake recurring plans removed`,
    { bookings, invoices, recurring },
    'admin',
  );
  return NextResponse.json({ bookings, invoices, recurring });
}
