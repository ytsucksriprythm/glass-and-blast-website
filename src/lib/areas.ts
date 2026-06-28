export type AreaPage = {
  slug: string;
  suburb: string;       // e.g. 'Gungahlin'
  title: string;        // SEO title
  description: string;  // meta description
  intro: string;        // unique local intro
  nearby: string[];     // nearby suburbs we also cover
  image: string;        // banner photo (varied per suburb)
  imageAlt: string;
};

// Local landing pages for the suburbs we work in most. Each has its own intro so
// the pages are not thin duplicates. Shared service/why-us copy is rendered by the route.
export const AREA_PAGES: AreaPage[] = [
  {
    slug: 'gungahlin',
    suburb: 'Gungahlin',
    title: 'Window Cleaning Gungahlin | Glass & Blast',
    description:
      'Window cleaning and pressure washing in Gungahlin, Canberra. Local, fully insured, streak-free results. One-off or regular plans. Free quote, usually same day.',
    intro:
      'Gungahlin and the suburbs around it have a lot of newer homes with big windows and plenty of glass, which look great clean and show every mark when they are not. We clean windows right across Gungahlin, from Harrison and Franklin through to Amaroo, Ngunnawal, Casey and Bonner.',
    nearby: ['Harrison', 'Franklin', 'Amaroo', 'Ngunnawal', 'Casey', 'Bonner', 'Forde', 'Crace'],
    image: '/work-pole-window.jpg',
    imageAlt: 'Cleaning a two-storey home window in Canberra with an extension pole',
  },
  {
    slug: 'belconnen',
    suburb: 'Belconnen',
    title: 'Window Cleaning Belconnen | Glass & Blast',
    description:
      'Window cleaning and pressure washing in Belconnen, Canberra. Local crew, fully insured, no streaks. One-off or regular plans. Free quote, usually same day.',
    intro:
      'Belconnen is one of our regular patches. Between the older established streets and the townhouses near the lake, we clean a real mix of homes here, and we know the access quirks that come with each one.',
    nearby: ['Bruce', 'Kaleen', 'Florey', 'Page', 'Scullin', 'Hawker', 'Macquarie', 'Aranda'],
    image: '/work-squeegee-hand.jpg',
    imageAlt: 'Squeegee cleaning a window to a streak-free finish in Canberra',
  },
  {
    slug: 'dickson',
    suburb: 'Dickson',
    title: 'Window Cleaning Dickson | Glass & Blast',
    description:
      'Window cleaning and pressure washing in Dickson and the inner north, Canberra. Local, fully insured, streak-free. Homes and shopfronts. Free quote.',
    intro:
      'Dickson sits right in our home patch in the inner north. We are in and out of Dickson, Downer and Watson most weeks, for both houses and the odd shopfront along the Dickson shops.',
    nearby: ['Downer', 'Watson', 'Hackett', 'Lyneham', 'Ainslie', 'Braddon'],
    image: '/work-pressure-wash.jpg',
    imageAlt: 'Pressure-washed driveway and path in the Canberra inner north',
  },
  {
    slug: 'ainslie',
    suburb: 'Ainslie',
    title: 'Window Cleaning Ainslie | Glass & Blast',
    description:
      'Window cleaning in Ainslie and Reid, Canberra. Careful work on character homes and timber-framed windows. Local, fully insured, streak-free. Free quote.',
    intro:
      'Ainslie is full of character homes with timber-framed windows that need a careful hand. We clean a lot of the older houses around Ainslie and Reid, taking the time the frames and glass deserve.',
    nearby: ['Reid', 'Braddon', 'Hackett', 'Dickson', 'Campbell', "O'Connor"],
    image: '/work-squeegee.jpg',
    imageAlt: 'Close-up of a freshly cleaned, streak-free window in Canberra',
  },
];

export const getArea = (slug: string) => AREA_PAGES.find(a => a.slug === slug);
