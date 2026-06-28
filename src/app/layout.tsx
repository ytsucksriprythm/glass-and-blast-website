import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { REVIEWS } from '@/lib/reviews';
import PageTracker from '@/components/PageTracker';

const SITE_URL = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Glass & Blast Window Cleaning | Award-Winning Canberra',
  description: '2025 Best Window Cleaner in North Canberra. Professional window washing and pressure cleaning for residential and commercial properties. 5-star rated, locally owned.',
  keywords: 'window cleaning Canberra, professional window cleaners, residential window cleaning, commercial window cleaning, pressure washing Canberra, window washer ACT, glass and blast',
  alternates: { canonical: '/' },
  verification: { google: 'kpP4WDW7oi9FoqQ-jsYv2VQu1sFhh7K9f24ZZnZ0668' },
  openGraph: {
    title: 'Glass & Blast Window Cleaning | Canberra',
    description: 'Award-winning window cleaning and pressure washing in Canberra. Book online today.',
    type: 'website',
    locale: 'en_AU',
    url: SITE_URL,
    siteName: 'Glass & Blast Window Cleaning',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Glass & Blast Window Cleaning, Canberra' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Glass & Blast Window Cleaning | Canberra',
    description: 'Award-winning window cleaning and pressure washing in Canberra.',
    images: ['/og.png'],
  },
};

// LocalBusiness structured data — helps Google + AI understand and recommend the business
const businessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HomeAndConstructionBusiness',
  '@id': `${SITE_URL}/#business`,
  name: 'Glass & Blast Window Cleaning',
  image: `${SITE_URL}/logo.png`,
  url: SITE_URL,
  telephone: '+61466050834',
  email: 'info@glassandblast.com.au',
  priceRange: '$$',
  areaServed: { '@type': 'City', name: 'Canberra' },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'North Canberra',
    addressRegion: 'ACT',
    addressCountry: 'AU',
  },
  description:
    'Award-winning, locally owned window cleaning and pressure washing in Canberra. Residential and commercial window cleaning with a streak-free finish.',
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '5', reviewCount: String(REVIEWS.length), bestRating: '5' },
  review: REVIEWS.map(r => ({
    '@type': 'Review',
    author: { '@type': 'Person', name: r.name },
    reviewRating: { '@type': 'Rating', ratingValue: String(r.stars), bestRating: '5' },
    reviewBody: r.quote,
  })),
  sameAs: [
    'https://www.facebook.com/profile.php?id=61573538586021',
    'https://www.google.com/maps/place/Glass+%26+Blast+Canberra',
  ],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Window Cleaning Services',
    itemListElement: [
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Window Washing', description: 'Streak-free residential and commercial window cleaning in Canberra.' } },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Pressure Washing', description: 'Driveway, path and exterior surface pressure cleaning in Canberra.' } },
    ],
  },
  openingHoursSpecification: [{
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '00:00', closes: '23:59',
  }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }} />
      </head>
      <body>
        <PageTracker />
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: '#0F2035', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' },
            success: { iconTheme: { primary: '#38BDF8', secondary: '#0A1628' } },
          }}
        />
      </body>
    </html>
  );
}
