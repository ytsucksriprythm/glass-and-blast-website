import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Phone, Check, Star, MapPin } from 'lucide-react';
import { AREA_PAGES, getArea } from '@/lib/areas';
import { GOOGLE_REVIEWS_URL } from '@/lib/reviews';

const SITE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export function generateStaticParams() {
  return AREA_PAGES.map(a => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = getArea(slug);
  if (!a) return { title: 'Area not found' };
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `/areas/${a.slug}` },
    openGraph: { title: a.title, description: a.description, type: 'website', images: ['/og.png'] },
  };
}

const WHAT_WE_DO = [
  'Window cleaning, inside and out, frames, sills and screens',
  'Squeegee and mop, by hand, for our Spot-Free Finish',
  'Pressure washing for driveways, paths and pavers',
  'Single and double-storey homes, plus shopfronts and offices',
];

const WHY = [
  'Fully insured, so your place is covered while we are there',
  'Free quotes in writing, the price we send is the price you pay',
  '2025 Best Window Cleaner in North Canberra',
  'Local crew, the people you book are the people who turn up',
];

export default async function AreaPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getArea(slug);
  if (!a) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: `Window Cleaning in ${a.suburb}`,
        serviceType: 'Window Cleaning',
        description: a.description,
        areaServed: { '@type': 'Place', name: `${a.suburb}, ACT` },
        provider: { '@type': 'HomeAndConstructionBusiness', name: 'Glass & Blast Window Cleaning', telephone: '+61466050834', url: SITE },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: `${a.suburb} window cleaning`, item: `${SITE}/areas/${a.slug}` },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

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
        <nav className="text-xs text-slate-500 mb-4">
          <Link href="/" className="hover:text-sky-600">Home</Link> <span className="mx-1">/</span>
          <span className="text-slate-600">{a.suburb}</span>
        </nav>

        <span className="text-sky-600 text-xs font-semibold uppercase tracking-[0.18em]">{a.suburb}, ACT</span>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 leading-tight mt-3">
          Window Cleaning in {a.suburb}
        </h1>

        {/* Rating line */}
        <a href={GOOGLE_REVIEWS_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
          <span className="inline-flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
          </span>
          <span className="font-semibold text-slate-900">5.0</span> on Google
        </a>

        <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-slate-200 mt-6">
          <Image src={a.image} alt={a.imageAlt} fill className="object-cover" sizes="(max-width: 768px) 100vw, 768px" priority />
        </div>

        <p className="text-slate-600 leading-relaxed mt-6 text-lg">{a.intro}</p>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold text-slate-900">What we do in {a.suburb}</h2>
          <ul className="mt-3 space-y-2">
            {WHAT_WE_DO.map(li => (
              <li key={li} className="text-slate-600 leading-relaxed flex items-start gap-2.5">
                <Check className="w-4 h-4 text-sky-500 mt-1 flex-shrink-0" /> {li}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold text-slate-900">Why {a.suburb} books us</h2>
          <ul className="mt-3 space-y-2">
            {WHY.map(li => (
              <li key={li} className="text-slate-600 leading-relaxed flex items-start gap-2.5">
                <Check className="w-4 h-4 text-sky-500 mt-1 flex-shrink-0" /> {li}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold text-slate-900">Streets and suburbs we cover near {a.suburb}</h2>
          <div className="flex flex-wrap gap-2 mt-3">
            {a.nearby.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-sm">
                <MapPin className="w-3 h-3 text-sky-500" /> {s}
              </span>
            ))}
          </div>
          <p className="text-slate-500 text-sm mt-4">
            Book us on a <Link href="/#plans" className="text-sky-600 hover:underline">regular plan</Link> and we drop the price on every clean.
          </p>
        </section>

        {/* CTA */}
        <div className="mt-12 rounded-lg border border-sky-200 bg-sky-50 p-6 text-center">
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">Get a free quote in {a.suburb}</h2>
          <p className="text-slate-600 text-sm mb-4">Usually back the same day. Fully insured, locally owned.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#book" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md transition-colors cursor-pointer">
              Get a free quote
            </Link>
            <a href="tel:+61466050834" className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 bg-white text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors cursor-pointer">
              <Phone className="w-4 h-4 text-sky-500" /> 0466 050 834
            </a>
          </div>
        </div>

        {/* Other areas */}
        <div className="mt-10 pt-6 border-t border-slate-200">
          <div className="text-slate-500 text-sm">Other areas we cover:</div>
          <div className="flex flex-wrap gap-2 mt-3">
            {AREA_PAGES.filter(o => o.slug !== a.slug).map(o => (
              <Link key={o.slug} href={`/areas/${o.slug}`} className="px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-sm hover:text-sky-600 hover:border-sky-300 transition-colors">
                {o.suburb}
              </Link>
            ))}
          </div>
        </div>
      </article>
    </main>
  );
}
