import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin', '/api'] },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
