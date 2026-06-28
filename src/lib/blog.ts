export type Section = { h?: string; p?: string[]; ul?: string[] };
export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;       // ISO
  readMins: number;
  excerpt: string;
  sections: Section[];
};

export const POSTS: Post[] = [
  {
    slug: 'window-cleaning-cost-canberra',
    title: 'How Much Does Window Cleaning Cost in Canberra?',
    description:
      'A clear guide to window cleaning prices in Canberra for 2026, including single and double story homes, what affects the price, and how to get an accurate quote.',
    date: '2026-02-10',
    readMins: 5,
    excerpt:
      'What you can expect to pay for professional window cleaning in Canberra, and the things that move the price up or down.',
    sections: [
      { p: [
        'If you are searching for window cleaning in Canberra, the first thing you want to know is the price. The honest answer is that it depends on your home, but there are clear ranges you can use to budget before you book.',
      ] },
      { h: 'Typical window cleaning prices in Canberra', p: [
        'Most single story homes in Canberra fall between about $150 and $400 for a full interior and exterior clean. The number of windows, the size of the glass, and how easy the windows are to reach all play a part.',
        'A two story home usually ranges from about $250 to $500, since the higher windows take more time and the right equipment to clean safely.',
        'Commercial window cleaning is quoted per site, because offices, shopfronts, and strata buildings vary so much in size and access.',
      ] },
      { h: 'What affects the price', ul: [
        'The number and size of your windows',
        'Inside only, or inside and out',
        'How accessible the windows are, including second story glass',
        'Extras like flyscreens, window tracks, or hard water stain removal',
        'How often you book, since regular cleans are usually quicker',
      ] },
      { h: 'How to get an accurate quote', p: [
        'The best way to know your exact price is a free quote. At Glass and Blast we give you a clear figure with no hidden fees, either online through our booking form or over the phone. We confirm any extras, such as travel outside the ACT, before we start.',
      ] },
      { h: 'Is it worth paying a professional', p: [
        'For ground floor windows you can do it yourself, but professional window cleaners get a streak free finish, reach high glass safely, and save you hours. For most Canberra homeowners the result and the convenience are well worth it.',
      ] },
    ],
  },
  {
    slug: 'how-often-should-you-clean-windows',
    title: 'How Often Should You Clean Your Windows?',
    description:
      'How often Canberra homes and businesses should have their windows cleaned, and the local factors that mean you might need it more or less often.',
    date: '2026-03-05',
    readMins: 4,
    excerpt:
      'A simple schedule for residential and commercial window cleaning, plus the Canberra factors that change it.',
    sections: [
      { p: [
        'There is no single right answer for how often to clean your windows, but a good rule of thumb keeps your glass clear without overspending.',
      ] },
      { h: 'A simple schedule', p: [
        'For most Canberra homes, twice a year is the sweet spot. A clean in spring clears away winter grime and pollen, and a clean in autumn deals with the dust of summer.',
        'Commercial properties usually need more frequent service, often monthly or fortnightly, because a clean shopfront or office directly affects how customers see the business.',
      ] },
      { h: 'When you might need it more often', ul: [
        'Homes near busy roads, which collect more dust and road film',
        'Properties surrounded by trees, which drop pollen, sap, and leaf litter',
        'Homes near building sites, where fine dust settles on glass',
        'Anywhere with sprinklers that hit the windows and leave hard water marks',
      ] },
      { h: 'Why regular cleaning matters', p: [
        'Beyond looking good, regular window cleaning protects the glass. Built up grime and hard water can slowly etch and stain windows, which is far more expensive to fix than a routine clean. Keeping a regular schedule is the cheapest way to protect your windows long term.',
      ] },
      { h: 'Not sure what suits your home', p: [
        'If you are unsure, we are happy to recommend a schedule based on where you live in Canberra and the condition of your windows. Get in touch for a free quote and we will suggest a plan that fits.',
      ] },
    ],
  },
  {
    slug: 'pressure-washing-driveway-canberra',
    title: 'Pressure Washing a Driveway in Canberra: What to Know',
    description:
      'How pressure washing works for Canberra driveways and paths, what results to expect, and when to call a professional rather than doing it yourself.',
    date: '2026-04-02',
    readMins: 4,
    excerpt:
      'Get your driveway and paths looking new again, and learn when professional pressure washing is the smarter choice.',
    sections: [
      { p: [
        'Over time, Canberra driveways and paths build up dirt, mould, moss, and stains that a hose simply cannot shift. Pressure washing blasts that grime away and can make old concrete or pavers look close to new.',
      ] },
      { h: 'What pressure washing can clean', ul: [
        'Concrete and exposed aggregate driveways',
        'Paths, paving, and courtyards',
        'Decks, patios, and outdoor entertaining areas',
        'Brick walls and fences',
        'Building exteriors',
      ] },
      { h: 'What results to expect', p: [
        'A good pressure wash removes surface grime, mould, and most stains, and it evens out the colour of the surface. Very old oil stains or deep discolouration may not lift completely, and a professional will tell you that upfront rather than promise a perfect result.',
      ] },
      { h: 'Doing it yourself versus hiring a pro', p: [
        'Hired or home pressure washers can damage surfaces if used at the wrong pressure or angle, stripping coatings or marking soft brick. Professionals match the pressure and technique to the surface, which protects your property and gives a more even finish.',
      ] },
      { h: 'Bundle it with your windows', p: [
        'Many Canberra customers have their driveway and paths pressure washed at the same visit as their window cleaning. It saves a second trip and we can bundle the price. Ask for a free quote and we will sort both in one go.',
      ] },
    ],
  },
  {
    slug: 'professional-window-cleaning-vs-diy',
    title: 'Professional Window Cleaning vs Doing It Yourself',
    description:
      'A practical comparison of DIY window cleaning and hiring professional window cleaners in Canberra, covering cost, results, safety, and time.',
    date: '2026-05-01',
    readMins: 4,
    excerpt:
      'When DIY is fine, when it is not, and what you actually get from professional window cleaners.',
    sections: [
      { p: [
        'Cleaning your own windows is a fair weekend job for ground floor glass. The question is whether the result and the time are worth it, especially for higher or harder windows.',
      ] },
      { h: 'The case for DIY', p: [
        'For a small home with easy to reach windows, doing it yourself costs only your time and a few supplies. If you are happy with a decent result and do not mind the effort, it can be enough.',
      ] },
      { h: 'Where professionals win', ul: [
        'A genuinely streak free finish from the right tools and proper technique',
        'Safe cleaning of second story and hard to reach glass',
        'Flyscreens, tracks, and frames cleaned properly, not just the glass',
        'Hours of your weekend saved',
        'Insurance cover, so any rare damage is handled',
      ] },
      { h: 'The real difference', p: [
        'The biggest gap is the finish on high or dirty windows. Professional window cleaners have the right squeegees, mops and technique to clear built up grime evenly, which is hard to match with a cloth on a weekend. For two story homes in particular, the safety and result make a professional clean the clear choice.',
      ] },
      { h: 'Try it once', p: [
        'If you have always done it yourself, it is worth booking one professional clean to see the difference. Get a free quote from Glass and Blast and compare the result to your usual weekend effort.',
      ] },
    ],
  },
];

export const getPost = (slug: string) => POSTS.find(p => p.slug === slug);
