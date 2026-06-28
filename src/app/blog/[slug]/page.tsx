import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, Phone } from 'lucide-react';
import { POSTS, getPost } from '@/lib/blog';

const SITE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Article not found' };
  return {
    title: `${post.title} | Glass & Blast Canberra`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.description, type: 'article', images: ['/og.png'] },
  };
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.date,
        image: `${SITE}/og.png`,
        author: { '@type': 'Organization', name: 'Glass & Blast Window Cleaning' },
        publisher: { '@type': 'Organization', name: 'Glass & Blast Window Cleaning', logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` } },
        mainEntityOfPage: `${SITE}/blog/${post.slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE}/blog/${post.slug}` },
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
          <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-sky-600 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> All guides
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-14">
        <nav className="text-xs text-slate-500 mb-4">
          <Link href="/" className="hover:text-sky-600">Home</Link> <span className="mx-1">/</span>
          <Link href="/blog" className="hover:text-sky-600">Guides</Link> <span className="mx-1">/</span>
          <span className="text-slate-600">{post.title}</span>
        </nav>

        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">{post.title}</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500 mt-3">
          <time dateTime={post.date}>{new Date(post.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {post.readMins} min read</span>
        </div>

        <div className="mt-8 space-y-6">
          {post.sections.map((s, i) => (
            <section key={i} className="space-y-3">
              {s.h && <h2 className="font-display text-xl font-semibold text-slate-900">{s.h}</h2>}
              {s.p?.map((para, j) => <p key={j} className="text-slate-600 leading-relaxed">{para}</p>)}
              {s.ul && (
                <ul className="space-y-2 pl-1">
                  {s.ul.map((li, j) => (
                    <li key={j} className="text-slate-600 leading-relaxed flex items-start gap-2">
                      <span className="text-sky-500 mt-1">•</span> {li}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 rounded-lg border border-sky-200 bg-sky-50 p-6 text-center">
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">Ready for a free quote?</h2>
          <p className="text-slate-600 text-sm mb-4">Award-winning window cleaning and pressure washing across Canberra.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#book" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md transition-colors cursor-pointer">
              Get a Free Quote
            </Link>
            <a href="tel:+61466050834" className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 bg-white text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors cursor-pointer">
              <Phone className="w-4 h-4 text-sky-500" /> 0466 050 834
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-sky-600 hover:text-sky-700 cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> More guides
          </Link>
        </div>
      </article>
    </main>
  );
}
