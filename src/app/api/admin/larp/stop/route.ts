import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { deleteBookingsByIdPrefix, deleteInvoicesByIdPrefix, deleteRecurringByIdPrefix, deletePageViewsByVisitorPrefix, updateSettings, logActivity } from '@/lib/db';
import { LARP_ID_PREFIX, LARP_VISITOR_PREFIX } from '@/lib/larp';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [bookings, invoices, recurring, pageViews] = await Promise.all([
    deleteBookingsByIdPrefix(LARP_ID_PREFIX),
    deleteInvoicesByIdPrefix(LARP_ID_PREFIX),
    deleteRecurringByIdPrefix(LARP_ID_PREFIX),
    deletePageViewsByVisitorPrefix(LARP_VISITOR_PREFIX),
  ]);
  await updateSettings({ larpModeActive: false });
  await logActivity(
    'larp.stopped',
    `LARP mode off — ${bookings} fake jobs, ${invoices} fake invoices, ${recurring} fake recurring plans, ${pageViews} fake page views removed`,
    { bookings, invoices, recurring, pageViews },
    'admin',
  );
  return NextResponse.json({ bookings, invoices, recurring, pageViews });
}
