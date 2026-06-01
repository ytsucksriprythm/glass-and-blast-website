export type Review = {
  name: string;
  date: string;   // fixed relative time — chosen once, stays forever
  stars: number;
  quote: string;
};

// Real Google reviews for Glass & Blast Canberra (all 5★).
// Dates are fixed, spread across the last ~2 years — they do not change on reload.
export const REVIEWS: Review[] = [
  {
    name: 'Hamish Stark',
    date: '3 weeks ago',
    stars: 5,
    quote: "Extremely high quality service, the two boys that came around were very polite and did a fantastic job. I don't think my windows have ever been this clean before.",
  },
  {
    name: 'david goldstein',
    date: '9 months ago',
    stars: 5,
    quote: 'Absolutely fantastic service from Glass and Blast Canberra. The two boys who came out were incredibly friendly, professional, and efficient. They arrived on time, explained everything clearly, and did a brilliant job with the windows. The pricing was very fair for the quality of work, and the whole process was smooth from start to finish. Highly recommend them to anyone looking for reliable and affordable window cleaning in Canberra.',
  },
  {
    name: 'Michele Lo Pilato',
    date: '5 months ago',
    stars: 5,
    quote: 'Really happy with the service. The windows were noticeably cleaner and they got rid of marks and dirt that had built up over time. Turned up when they said they would, were friendly and easy to deal with, and got the job done without any hassle. Pricing was fair as well. Would definitely use them again.',
  },
  {
    name: 'Jai Muthiah',
    date: '1 month ago',
    stars: 5,
    quote: 'Great service from start to finish. The team was friendly, arrived on time, and did an amazing job cleaning the windows. They look spotless now. Very professional and reasonably priced. Would definitely recommend and use again.',
  },
  {
    name: 'Harisen Smith',
    date: '1 year ago',
    stars: 5,
    quote: 'High-quality window cleaning service, polite staff, and punctual service.',
  },
  {
    name: 'Sophie Moreman',
    date: '7 months ago',
    stars: 5,
    quote: 'Lincoln and his team were very professional, did a very good job. Very kind team.',
  },
  {
    name: 'Keren Zhang',
    date: '2 weeks ago',
    stars: 5,
    quote: 'Great clean, polite staff, would recommend. They get it done quick and low cost.',
  },
];

export const GOOGLE_REVIEWS_URL =
  'https://www.google.com/maps/place/Glass+%26+Blast+Canberra/@-35.2641588,149.129846,17z/data=!4m6!3m5!1s0x86988222311ebd0b:0xdc5b58d488c06a36!8m2!3d-35.2641588!4d149.1323995!16s%2Fg%2F11x1pjbn9b?hl=en';
