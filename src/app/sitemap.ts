import type { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';
import { SERVICE_PAGES } from '@/lib/services';
import { AREA_PAGES } from '@/lib/areas';

const BASE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,        lastModified: now, changeFrequency: 'weekly',  priority: 1 },
    { url: `${BASE}/faq`,     lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/blog`,    lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ];
  const servicePages: MetadataRoute.Sitemap = SERVICE_PAGES.map(s => ({
    url: `${BASE}/services/${s.slug}`, lastModified: now, changeFrequency: 'monthly', priority: 0.8,
  }));
  const blogPages: MetadataRoute.Sitemap = POSTS.map(p => ({
    url: `${BASE}/blog/${p.slug}`, lastModified: new Date(p.date), changeFrequency: 'yearly', priority: 0.6,
  }));
  const areaPages: MetadataRoute.Sitemap = AREA_PAGES.map(a => ({
    url: `${BASE}/areas/${a.slug}`, lastModified: now, changeFrequency: 'monthly', priority: 0.7,
  }));
  return [...staticPages, ...servicePages, ...blogPages, ...areaPages];
}
