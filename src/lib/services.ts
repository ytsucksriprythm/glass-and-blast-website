import type { Section } from './blog';

export type ServicePage = {
  slug: string;
  serviceName: string;
  title: string;      // SEO title
  h1: string;
  description: string;
  intro: string;
  sections: Section[];
};

export const SERVICE_PAGES: ServicePage[] = [
  {
    slug: 'commercial-window-cleaning-canberra',
    serviceName: 'Commercial Window Cleaning',
    title: 'Commercial Window Cleaning Canberra | Glass & Blast',
    h1: 'Commercial Window Cleaning in Canberra',
    description:
      'Professional commercial window cleaning in Canberra for offices, retail, and strata. Reliable scheduled service, fully insured, streak-free results. Free quote.',
    intro:
      'Clean windows make a real difference to how customers and tenants see your business. Glass and Blast provides reliable commercial window cleaning across Canberra for offices, shopfronts, retail spaces, and strata complexes.',
    sections: [
      { h: 'Who we work with', ul: [
        'Offices and corporate buildings',
        'Retail shopfronts and showrooms',
        'Strata and apartment complexes',
        'Cafes, restaurants, and hospitality venues',
        'Medical, dental, and professional suites',
      ] },
      { h: 'Why businesses choose us', p: [
        'We are locally owned, fully insured, and award winning, named 2025 Best Window Cleaner in North Canberra. We turn up on time, work safely around your staff and customers, and leave the glass streak free every visit.',
        'For higher windows we use water fed poles and purified water, which means a clean finish without ladders blocking entrances or walkways.',
      ] },
      { h: 'Flexible scheduling', p: [
        'Most commercial clients book a regular schedule, often monthly or fortnightly, so your premises always look their best. We can work before or after hours to avoid disrupting trade, and we will tailor a plan to your building and budget.',
      ] },
      { h: 'Get a commercial quote', p: [
        'Tell us about your building and we will provide a clear, no obligation quote. For larger sites we can arrange a quick walk through first. Call 0466 050 834 or request a quote online.',
      ] },
    ],
  },
  {
    slug: 'pressure-washing-canberra',
    serviceName: 'Pressure Washing',
    title: 'Pressure Washing Canberra | Driveways & Exteriors | Glass & Blast',
    h1: 'Pressure Washing in Canberra',
    description:
      'Professional pressure washing in Canberra for driveways, paths, decks, and building exteriors. Remove dirt, mould, and stains. Fully insured. Free quote.',
    intro:
      'Glass and Blast provides professional pressure washing across Canberra, bringing tired driveways, paths, and exteriors back to life. We match the pressure and technique to each surface so the finish is even and the surface stays protected.',
    sections: [
      { h: 'What we pressure wash', ul: [
        'Concrete and exposed aggregate driveways',
        'Paths, paving, and courtyards',
        'Decks, patios, and outdoor areas',
        'Brick walls and fences',
        'Building and shopfront exteriors',
      ] },
      { h: 'The results you can expect', p: [
        'Pressure washing removes built up dirt, mould, moss, and most stains, and it evens out the colour of the surface. We are upfront about what will and will not lift, so you know what to expect before we start.',
      ] },
      { h: 'Safe for your surfaces', p: [
        'Used incorrectly, a pressure washer can strip coatings or mark soft brick and timber. Our team adjusts pressure and angle to suit each surface, protecting your property while still delivering a deep clean.',
      ] },
      { h: 'Bundle with window cleaning', p: [
        'Many Canberra customers combine pressure washing with their window cleaning in a single visit. It saves time and we can bundle the price. Call 0466 050 834 or request a free quote online.',
      ] },
    ],
  },
];

export const getService = (slug: string) => SERVICE_PAGES.find(s => s.slug === slug);
