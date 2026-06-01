import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { POSTS } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Window Cleaning Tips & Guides | Glass & Blast Canberra',
  description:
    'Helpful guides on window cleaning and pressure washing in Canberra: costs, how often to clean, DIY vs professional, and more from Glass & Blast.',
  keywords: 'window cleaning Canberra, window cleaning tips, pressure washing Canberra, window cleaning blog',
  alternates: { canonical: '/blog' },
};

export default function BlogIndex() {
  const posts = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <main className="min-h-screen bg-navy-900">
      <header className="border-b border-white/5">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={150} height={60} className="object-contain h-12 w-auto" />
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-sky-400 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to site
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-2 text-sky-400 text-sm font-semibold tracking-widest uppercase">
            <span className="w-6 h-px bg-sky-400" /> Guides <span className="w-6 h-px bg-sky-400" />
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-white mt-4">Window Cleaning Tips for Canberra</h1>
          <p className="text-slate-400 mt-4">Practical advice on keeping your windows and exteriors looking their best.</p>
        </div>

        <div className="space-y-4">
          {posts.map(p => (
            <Link key={p.slug} href={`/blog/${p.slug}`} className="block glass rounded-2xl border border-white/8 p-6 hover:border-sky-400/25 transition-colors cursor-pointer group">
              <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                <time dateTime={p.date}>{new Date(p.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {p.readMins} min read</span>
              </div>
              <h2 className="font-display text-xl font-bold text-white group-hover:text-sky-300 transition-colors">{p.title}</h2>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{p.excerpt}</p>
              <span className="inline-flex items-center gap-1 text-sky-400 text-sm font-semibold mt-3">Read more <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
