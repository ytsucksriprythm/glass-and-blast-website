import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Phone } from 'lucide-react';
import { FAQS } from '@/lib/faq';

export const metadata: Metadata = {
  title: 'Window Cleaning FAQ Canberra | Glass & Blast',
  description:
    'Answers to common questions about window cleaning in Canberra: cost, what is included, how often to clean, residential and commercial window cleaning, insurance, quotes and more.',
  keywords:
    'window cleaning Canberra, professional window cleaners, residential window cleaning, commercial window cleaning, window cleaning cost Canberra, window cleaning FAQ',
  alternates: { canonical: '/faq' },
};

const SITE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

// FAQPage + Breadcrumb structured data
function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: FAQS.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'FAQ', item: `${SITE}/faq` },
        ],
      },
    ],
  };
}

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }} />

      {/* Top bar */}
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={150} height={60} className="object-contain h-12 w-auto" />
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-sky-600 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to site
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-14">
        <div className="text-center mb-10">
          <span className="text-sky-600 text-xs font-semibold uppercase tracking-[0.18em]">FAQ</span>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-slate-900 mt-3">Window Cleaning Questions, Answered</h1>
          <p className="text-slate-600 mt-4">
            Everything Canberra homeowners and businesses ask about professional window cleaning. Still unsure? Call us on{' '}
            <a href="tel:+61466050834" className="text-sky-600 hover:underline">0466 050 834</a>.
          </p>
        </div>

        {/* Accordion (native details = SEO friendly, no JS needed) */}
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <details key={i} className="group rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
              <summary className="flex items-center justify-between gap-4 cursor-pointer px-5 py-4 list-none">
                <h2 className="text-slate-900 font-medium text-base">{f.q}</h2>
                <ChevronDown className="w-5 h-5 text-sky-600 flex-shrink-0 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-5 -mt-1">
                <p className="text-slate-600 text-sm leading-relaxed">{f.a}</p>
              </div>
            </details>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link href="/#book" className="inline-flex items-center gap-2 px-7 py-3.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md transition-colors cursor-pointer">
            <Phone className="w-4 h-4" /> Get a Free Quote
          </Link>
        </div>
      </article>
    </main>
  );
}
