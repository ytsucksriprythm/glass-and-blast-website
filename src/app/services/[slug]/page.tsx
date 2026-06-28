import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Phone, CheckCircle } from 'lucide-react';
import { SERVICE_PAGES, getService } from '@/lib/services';

const SITE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export function generateStaticParams() {
  return SERVICE_PAGES.map(s => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = getService(slug);
  if (!s) return { title: 'Service not found' };
  return {
    title: s.title,
    description: s.description,
    alternates: { canonical: `/services/${s.slug}` },
    openGraph: { title: s.title, description: s.description, type: 'website', images: ['/og.png'] },
  };
}

export default async function ServicePageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getService(slug);
  if (!s) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: s.serviceName,
        serviceType: s.serviceName,
        description: s.description,
        areaServed: { '@type': 'City', name: 'Canberra' },
        provider: { '@type': 'HomeAndConstructionBusiness', name: 'Glass & Blast Window Cleaning', telephone: '+61466050834', url: SITE },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: s.serviceName, item: `${SITE}/services/${s.slug}` },
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
          <span className="text-slate-600">{s.serviceName}</span>
        </nav>

        <span className="text-sky-600 text-xs font-semibold uppercase tracking-[0.18em]">Canberra</span>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 leading-tight mt-3">{s.h1}</h1>
        <p className="text-slate-600 leading-relaxed mt-4 text-lg">{s.intro}</p>

        <div className="mt-8 space-y-6">
          {s.sections.map((sec, i) => (
            <section key={i} className="space-y-3">
              {sec.h && <h2 className="font-display text-xl font-semibold text-slate-900">{sec.h}</h2>}
              {sec.p?.map((para, j) => <p key={j} className="text-slate-600 leading-relaxed">{para}</p>)}
              {sec.ul && (
                <ul className="space-y-2">
                  {sec.ul.map((li, j) => (
                    <li key={j} className="text-slate-600 leading-relaxed flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-sky-500 mt-1 flex-shrink-0" /> {li}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-lg border border-sky-200 bg-sky-50 p-6 text-center">
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">Get a free quote today</h2>
          <p className="text-slate-600 text-sm mb-4">Award-winning, fully insured, locally owned in Canberra.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#book" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md transition-colors cursor-pointer">
              Get a Free Quote
            </Link>
            <a href="tel:+61466050834" className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 bg-white text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors cursor-pointer">
              <Phone className="w-4 h-4 text-sky-500" /> 0466 050 834
            </a>
          </div>
        </div>
      </article>
    </main>
  );
}
