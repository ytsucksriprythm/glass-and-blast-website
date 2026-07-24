import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBookingByToken, getPhotos, getInvoicesForBooking, getSettings } from '@/lib/db';
import FeedbackWidget from './FeedbackWidget';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Thank you | Glass and Blast',
  robots: { index: false, follow: false },
};

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function ThanksPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getBookingByToken(token);
  if (!booking) return notFound();

  const [photos, invoices, settings] = await Promise.all([
    getPhotos(booking.id),
    getInvoicesForBooking(booking.id),
    getSettings(),
  ]);
  const invoice = invoices[0] ?? null;
  const before = photos.filter(p => p.type === 'before');
  const after = photos.filter(p => p.type === 'after');
  const hasPhotos = before.length > 0 || after.length > 0;
  const firstName = (booking.name || '').split(' ')[0];

  return (
    <main className="min-h-[100svh] bg-slate-50 text-slate-900">
      <div className="max-w-2xl mx-auto px-5 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="font-display text-3xl font-extrabold tracking-tight">Glass and Blast</div>
          <div className="text-slate-500 text-sm mt-1">Window Cleaning &nbsp;|&nbsp; North Canberra &amp; Greater ACT</div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8 text-center">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Thank you{firstName ? `, ${firstName}` : ''}!</h1>
          <p className="text-slate-600 mt-2">We really appreciate your business.</p>
          {booking.status === 'completed' && booking.completedAt && (
            <p className="mt-3 inline-block rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold px-3 py-1">
              Job completed {longDate(booking.completedAt)}
            </p>
          )}

          {/* Options */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {invoice && (
              <a href={`/invoice/${invoice.token}`} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors">
                View invoice
              </a>
            )}
            {hasPhotos && (
              <a href="#photos" className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-300 hover:border-sky-400 text-slate-800 font-semibold transition-colors">
                View before &amp; after photos
              </a>
            )}
          </div>
        </div>

        {/* Feedback */}
        {settings.customerFeedbackEnabled && (
          <div className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
            <FeedbackWidget
              token={token}
              alreadyRated={booking.feedbackStars ?? null}
              reviewUrl={settings.googleReviewUrl}
              starThreshold={settings.reviewStarThreshold}
            />
          </div>
        )}

        {/* Photos */}
        {hasPhotos && (
          <div id="photos" className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8 scroll-mt-6">
            <h2 className="font-display text-xl font-bold mb-4">Before &amp; after</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">Before</div>
                <div className="space-y-3">
                  {before.length === 0 ? <div className="text-slate-400 text-sm">No photos</div> :
                    /* eslint-disable-next-line @next/next/no-img-element */
                    before.map(p => <img key={p.id} src={p.url} alt="Before" className="w-full rounded-lg border border-slate-200" />)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">After</div>
                <div className="space-y-3">
                  {after.length === 0 ? <div className="text-slate-400 text-sm">No photos</div> :
                    /* eslint-disable-next-line @next/next/no-img-element */
                    after.map(p => <img key={p.id} src={p.url} alt="After" className="w-full rounded-lg border border-slate-200" />)}
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-slate-400 text-xs mt-8">Glass and Blast &nbsp;·&nbsp; glassandblast.com.au</p>
      </div>
    </main>
  );
}
