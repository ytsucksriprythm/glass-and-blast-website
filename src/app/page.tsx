'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import Image, { type ImageProps } from 'next/image';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Phone, MapPin, Star, Award, Check, CheckCircle, Clock, Shield,
  Menu, X, Facebook, Lock, Search, Calendar, MoveHorizontal,
} from 'lucide-react';
import Reviews from '@/components/Reviews';

// ─── Constants ─────────────────────────────────────────────────────────────

const PHONE_DISPLAY = '0466 050 834';
const PHONE_HREF = 'tel:+61466050834';

const NAV_LINKS = [
  { label: 'Work', href: '#work' },
  { label: 'Services', href: '#services' },
  { label: 'Plans', href: '#plans' },
  { label: 'Reviews', href: '#reviews' },
  { label: 'Areas', href: '#areas' },
];

// Recurring plan tiers — discount per clean off jobs over $200. Quarterly highlighted.
const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly',
    cadence: 'We come every month',
    discount: '$100 off',
    popular: false,
    points: ['Biggest saving per clean', 'Your glass never gets a chance to build up', 'Priority booking, jump the queue'],
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    cadence: 'Every three months',
    discount: '$75 off',
    popular: true,
    points: ['The rate most homes settle on', 'Stays on top of Canberra dust and pollen', 'Priority booking'],
  },
  {
    id: 'bi-annual',
    name: 'Twice a year',
    cadence: 'Every six months',
    discount: '$50 off',
    popular: false,
    points: ['Keeps the worst of it off', 'A spring and an autumn clean', 'No lock-in, cancel anytime'],
  },
];

const STEPS = [
  { n: '1', title: 'You book us', text: 'Send the form or give us a call to get the ball rolling.' },
  { n: '2', title: 'We quote in person', text: 'We call you back, arrange a time, come out and price the job face to face.' },
  { n: '3', title: 'We clean', text: 'Happy with the quote? We lock in a day and get your glass spotless.' },
  { n: '4', title: 'You pay', text: 'Once it is done and you are happy with it, you settle up. Easy.' },
];

// Two real services. No icon-in-a-circle, the photo does the talking.
const SERVICES = [
  {
    id: 'window-washing',
    title: 'Window cleaning',
    photo: '/work-squeegee.jpg',
    photoAlt: 'Squeegee leaving a clean, streak-free finish on a Canberra window',
    objectPos: 'center 50%',
    blurb: 'Cleaned by hand with a squeegee and mop, inside and out, with the frames, sills and screens wiped down. We take our time and check the glass before we leave, so you get our Spot-Free Finish with no streaks left behind.',
    points: [
      'Inside, outside, frames, sills and screens',
      'Single and double-storey homes',
      'Our Spot-Free Finish, every pane checked',
      'Most homes from about $200',
    ],
  },
  {
    id: 'pressure-washing',
    title: 'Pressure washing',
    photo: '/work-brick-path.png',
    photoAlt: 'Brick pathway brought back to life after a pressure wash',
    objectPos: 'center 50%',
    blurb: 'Driveways, paths and pavers that have gone green and grimy over the years, brought back close to new. We set the pressure to suit the surface so the concrete or brick is cleaned, not chewed up.',
    points: [
      'Driveways, paths, pavers, courtyards',
      'Brick, render and fences',
      'Priced per job after a quick look or a few photos',
    ],
  },
  {
    id: 'solar-panel-cleaning',
    title: 'Solar panel cleaning',
    photo: '/work-solar-1.jpg',
    photoAlt: 'Freshly cleaned rooftop solar panels reflecting the Canberra sky',
    objectPos: 'center 60%',
    blurb: 'Dust, pollen and bird mess build up on the glass and quietly drop your output. We clean the panels with the right gear and pure water, no harsh chemicals near the cells, so they soak up the sun again.',
    points: [
      'More output from cleaner glass',
      'Worked safely from the roof',
      'No scratching, no harsh chemicals',
    ],
  },
];

// ─── Small helpers ───────────────────────────────────────────────────────────

// Scroll-scrubbed reveal: progress is tied to how far the element has travelled up
// the viewport (fades in between the 97% and ~78% lines), so scrolling drives the
// animation directly — stop scrolling and it pauses, scroll back and it reverses.
// `delay` shifts the finish line down slightly so staggered items trail each other.
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.97', `start ${0.78 - Math.min(delay, 0.18)}`],
  });
  const y = useTransform(scrollYProgress, [0, 1], [28, 0]);

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} style={{ opacity: scrollYProgress, y }} className={className}>
      {children}
    </motion.div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 text-sky-600 text-xs font-semibold uppercase tracking-[0.22em]">
      <span aria-hidden className="h-px w-8 bg-sky-500/60" />
      {children}
    </span>
  );
}

function Stars({ n = 5 }: { n?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: n }).map((_, i) => (
        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

// Scroll a section into a comfortable position: centred in the space under the
// fixed navbar when it fits, otherwise its heading sits in the upper third so it
// reads as deliberately placed on phones (where most sections are taller than the
// screen) instead of jammed under the navbar. Avoids the default scrollIntoView
// behaviour where the target hides under the navbar or clamps to the page bottom.
function smoothScrollTo(href: string) {
  const el = document.querySelector(href);
  if (!el) return;
  // Measure the real fixed header (64px mobile / 80px desktop) rather than guess,
  // so the centring is accurate on every screen size.
  const header = document.querySelector('header');
  const navH = (header ? header.getBoundingClientRect().height : 72) + 12; // + breathing room
  const rect = el.getBoundingClientRect();
  const elTop = rect.top + window.scrollY;
  const usable = window.innerHeight - navH;
  const target = rect.height <= usable
    ? elTop - navH - (usable - rect.height) / 2          // fits: centre it
    : elTop - navH - Math.min(usable * 0.18, 140);       // taller than screen: heading in upper third
  window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

const goToBook = () => smoothScrollTo('#book');

// next/image with a skeleton placeholder behind it. The image renders normally on
// top, so it shows even without JS; the pulsing skeleton sits behind and is removed
// once the photo loads. Parent must be `relative`.
function SkeletonImage(props: ImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <span aria-hidden className="absolute inset-0 bg-slate-200 animate-pulse" />}
      <Image {...props} onLoad={() => setLoaded(true)} />
    </>
  );
}

// ─── Navbar ─────────────────────────────────────────────────────────────────

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    fn(); // reflect initial scroll position (e.g. reload while scrolled, or anchor link)
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const scrollTo = (href: string) => {
    setOpen(false);
    smoothScrollTo(href);
  };

  const solid = scrolled || open;          // white bar
  const onDark = !solid;                    // transparent over the dark hero
  const linkClass = onDark ? 'text-white/90 hover:text-white' : 'text-slate-600 hover:text-slate-900';

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${solid ? 'bg-white/95 border-b border-slate-200 backdrop-blur-sm shadow-sm' : 'bg-transparent'}`}>
      <div className="max-w-6xl mx-auto pl-4 pr-3 sm:px-6 flex items-center justify-between h-16 sm:h-20">
        <button onClick={() => scrollTo('#hero')} className="flex items-center cursor-pointer" aria-label="Glass & Blast home">
          <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={300} height={120} className="object-contain h-14 sm:h-[4.5rem] w-auto" priority />
        </button>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(l => (
            <button key={l.href} onClick={() => scrollTo(l.href)} className={`px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${linkClass}`}>
              {l.label}
            </button>
          ))}
          <a href="/faq" className={`px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${linkClass}`}>FAQ</a>
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <a href={PHONE_HREF} className={`flex items-center gap-2 text-sm font-semibold transition-colors cursor-pointer ${onDark ? 'text-white hover:text-sky-200' : 'text-slate-800 hover:text-sky-600'}`}>
            <Phone className="w-4 h-4 text-sky-500" />
            {PHONE_DISPLAY}
          </a>
          <button onClick={goToBook} className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold rounded-full transition-colors cursor-pointer">
            Get a free quote
          </button>
        </div>

        {/* Mobile: phone always visible + menu toggle */}
        <div className="flex items-center gap-1.5 md:hidden">
          <a href={PHONE_HREF} aria-label={`Call ${PHONE_DISPLAY}`} className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-500 text-white text-sm font-semibold rounded-full cursor-pointer">
            <Phone className="w-4 h-4" /> Call
          </a>
          <button onClick={() => setOpen(o => !o)} aria-label="Menu" className={`p-2 cursor-pointer ${onDark ? 'text-white' : 'text-slate-800'}`}>
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden overflow-hidden bg-white border-t border-slate-200"
          >
            <div className="px-5 py-3 flex flex-col">
              {NAV_LINKS.map(l => (
                <button key={l.href} onClick={() => scrollTo(l.href)} className="py-3 text-left text-slate-700 text-base font-medium border-b border-slate-100 cursor-pointer">
                  {l.label}
                </button>
              ))}
              <a href="/faq" className="py-3 text-slate-700 text-base font-medium border-b border-slate-100">FAQ</a>
              <button onClick={() => scrollTo('#book')} className="mt-3 px-4 py-3 bg-sky-500 text-white text-base font-semibold rounded-full cursor-pointer">
                Get a free quote
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

// ─── Hero (kept dark over the video, hands off to the light page below) ──────

function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = 0.7;
    const onMeta = () => { v.playbackRate = 0.7; };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, []);

  return (
    <section id="hero" className="relative min-h-[100svh] flex items-center overflow-hidden">
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          autoPlay muted loop playsInline preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
          poster="/work-window-pole.jpg"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-navy-900/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-navy-900 via-navy-900/75 to-navy-900/25" />
      </div>

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pt-24 pb-16">
        <div className="max-w-2xl">
          <Reveal>
            <span className="inline-block text-sky-300 text-xs font-semibold uppercase tracking-[0.18em]">Window cleaning &amp; pressure washing · North Canberra</span>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="font-display text-[2.6rem] leading-[1.06] sm:text-6xl lg:text-[4.25rem] sm:leading-[1.03] font-extrabold text-white tracking-[-0.02em] mt-5">
              The window cleaners North Canberra keeps calling back
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="text-slate-200 text-base sm:text-lg leading-relaxed mt-5 max-w-xl">
              We are a small local crew cleaning windows and pressure washing for homes and businesses around
              Gungahlin, Belconnen and the inner north. Fully insured, and we do not pack up until the glass is clear.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="flex flex-col sm:flex-row gap-3 mt-7">
              <button onClick={goToBook} className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-full transition-colors cursor-pointer">
                Get a free quote
              </button>
              <a href={PHONE_HREF} className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-white/10 hover:bg-white/20 border border-white/25 text-white font-semibold rounded-full transition-colors cursor-pointer">
                <Phone className="w-4 h-4 text-sky-300" /> Call {PHONE_DISPLAY}
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-8 text-sm">
              <span className="inline-flex items-center gap-1.5 text-slate-100">
                <Stars /> <span className="font-semibold text-white">5.0</span> on Google
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-200">
                <Award className="w-4 h-4 text-sky-300" /> 2025 Best Window Cleaner, North Canberra
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-200">
                <Shield className="w-4 h-4 text-sky-300" /> Fully insured
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── Trust strip ─────────────────────────────────────────────────────────────

function TrustStrip() {
  const items = [
    { icon: Star, text: '5.0 on Google' },
    { icon: Award, text: '2025 Best Window Cleaner, North Canberra' },
    { icon: Shield, text: 'Fully insured' },
    { icon: MapPin, text: 'Locally owned and operated' },
  ];
  return (
    <section className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 lg:grid-cols-4 gap-y-5 lg:divide-x lg:divide-slate-200">
        {items.map(i => (
          <div key={i.text} className="flex items-center gap-2.5 text-slate-600 text-[13px] font-medium lg:justify-center lg:px-4">
            <i.icon className="w-4 h-4 text-sky-500 flex-shrink-0" />
            <span>{i.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Before / after slider (drag to reveal) ──────────────────────────────────

function BeforeAfter() {
  const [pos, setPos] = useState(55);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={ref}
      className="relative aspect-[3/4] w-full overflow-hidden rounded-xl select-none touch-pan-y cursor-ew-resize"
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) move(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      {/* After is the base layer; before is clipped on top from the left */}
      <SkeletonImage src="/after-sliding-door.jpg" alt="Sliding door glass after cleaning, clear and streak-free" fill sizes="(max-width: 768px) 100vw, 420px" className="object-cover pointer-events-none" />
      <Image
        src="/before-sliding-door.jpg"
        alt="Sliding door glass before cleaning, hazy and marked"
        fill sizes="(max-width: 768px) 100vw, 420px"
        className="object-cover pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-slate-900/70 text-white text-xs font-semibold">Before</span>
      <span className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-sky-500 text-white text-xs font-semibold">After</span>

      {/* Handle */}
      <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -translate-x-1/2 w-0.5 bg-white/90" />
        <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-md flex items-center justify-center">
          <MoveHorizontal className="w-4 h-4 text-slate-700" />
        </div>
      </div>
    </div>
  );
}

// ─── Our work ────────────────────────────────────────────────────────────────

function Work() {
  const shots = [
    { src: '/work-pole-window.jpg', label: 'Second-storey window clean', place: "O'Connor", pos: 'center 40%' },
    { src: '/work-squeegee-hand.jpg', label: 'Streak-free window clean', place: 'Ainslie', pos: 'center 28%' },
    { src: '/work-pressure-wash.jpg', label: 'Driveway pressure wash', place: 'Canberra', pos: 'center 50%' },
    { src: '/work-solar-2.jpg', label: 'Solar panel clean', place: 'Ainslie', pos: 'center 45%' },
  ];
  return (
    <section id="work" className="bg-slate-50 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal className="max-w-2xl">
          <Kicker>Recent work</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3">
            A few jobs from around the inner north
          </h2>
          <p className="text-slate-600 mt-3">
            Same crew, same gear, every visit. Here is some recent window and pressure washing work across Canberra.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-12">
          {shots.map((s, i) => (
            <Reveal key={s.src} delay={i * 0.06} className="group relative overflow-hidden rounded-xl">
              <div className="relative aspect-[3/4]">
                <SkeletonImage src={s.src} alt={`${s.label} in ${s.place}, Canberra`} fill style={{ objectPosition: s.pos }} className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" sizes="(max-width: 1024px) 100vw, 33vw" />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-navy-900/90 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-4">
                  <div className="text-white text-sm font-semibold">{s.label}</div>
                  <div className="text-slate-200 text-xs mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-sky-300" /> {s.place}, ACT
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Before / after */}
        <Reveal delay={0.1} className="mt-14 grid lg:grid-cols-[0.85fr_1.15fr] gap-8 lg:gap-12 items-center">
          <div className="w-full max-w-sm mx-auto">
            <BeforeAfter />
          </div>
          <div>
            <Kicker>Before &amp; after</Kicker>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-3">Drag to see the difference</h3>
            <p className="text-slate-600 mt-3 leading-relaxed">
              Same sliding door, same visit. Hazy, marked glass on one side, clear and streak-free on the other.
              Drag the handle across to compare.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Services + pricing ──────────────────────────────────────────────────────

function Services() {
  return (
    <section id="services" className="bg-white border-t border-slate-200 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal className="max-w-2xl">
          <Kicker>What we do</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3">
            Three things, done properly
          </h2>
        </Reveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
          {SERVICES.map((svc, i) => (
            <Reveal key={svc.id} delay={i * 0.08} className="rounded-xl bg-white overflow-hidden">
              <div className="relative h-72 sm:h-80 w-full">
                <SkeletonImage src={svc.photo} alt={svc.photoAlt} fill style={{ objectPosition: svc.objectPos }} className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
              </div>
              <div className="p-6 sm:p-7">
                <h3 className="font-display text-xl font-bold text-slate-900">{svc.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed mt-3">{svc.blurb}</p>
                <ul className="mt-5 space-y-2">
                  {svc.points.map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-slate-700 text-sm">
                      <Check className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
                <button onClick={goToBook} className="mt-6 text-sky-600 hover:text-sky-700 text-sm font-semibold cursor-pointer">
                  Get a quote for {svc.title.toLowerCase()} →
                </button>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Add-ons + bundle */}
        <Reveal delay={0.1}>
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-slate-600 text-sm leading-relaxed max-w-2xl">
              We also do <span className="text-slate-900 font-medium">flyscreen repairs, gutter and roof cleaning,
              soft washing and end-of-lease cleans</span>, and if you need something else sorted, just give us a call.
              Booking two or more jobs in the one visit? We will bring the total down for you.
            </p>
            <button onClick={goToBook} className="flex-shrink-0 px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold rounded-full transition-colors cursor-pointer">
              Ask for a price
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section id="how" className="bg-slate-50 border-t border-slate-200 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal className="max-w-2xl">
          <Kicker>How it works</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3">Booking us is the easy part</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8 mt-10">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06} className="border-t-2 border-navy-900 pt-5">
              <div className="font-display text-5xl font-extrabold text-slate-200 leading-none select-none" aria-hidden>
                {s.n.padStart(2, '0')}
              </div>
              <h3 className="text-slate-900 font-semibold mt-4">{s.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed mt-2">{s.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Plans ───────────────────────────────────────────────────────────────────

function Plans() {
  return (
    <section id="plans" className="bg-white border-t border-slate-200 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal className="max-w-2xl">
          <Kicker>Plans</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3">Book a regular clean, pay less every time</h2>
          <p className="text-slate-600 mt-3">
            Put us on a cycle and we drop the price on every visit. Same clean, lower rate, and your place never gets a chance to look grubby.
          </p>
        </Reveal>

        <div className="grid lg:grid-cols-3 gap-5 mt-10 items-start">
          {PLANS.map((p, i) => {
            const hot = p.popular;
            return (
              <Reveal key={p.id} delay={i * 0.07}
                className={`rounded-xl border overflow-hidden ${hot ? 'border-navy-900 bg-navy-900 shadow-card-lg lg:-mt-3 lg:mb-3' : 'border-slate-200 bg-white shadow-card'}`}>
                <div className="p-6 sm:p-8">
                  {hot && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white bg-sky-500 rounded-full px-3 py-1 mb-4">
                      <Star className="w-3.5 h-3.5 fill-white text-white" /> Most popular
                    </span>
                  )}
                  <div className={`flex items-center gap-2 ${hot ? 'text-slate-300' : 'text-slate-600'}`}>
                    <Calendar className="w-4 h-4" />
                    <span className="font-semibold">{p.name}</span>
                  </div>
                  <div className={`mt-4 font-display text-4xl font-extrabold tracking-tight ${hot ? 'text-white' : 'text-slate-900'}`}>{p.discount}</div>
                  <div className={`text-sm ${hot ? 'text-slate-400' : 'text-slate-500'}`}>every clean · {p.cadence.toLowerCase()}</div>
                  <ul className="mt-6 space-y-2.5">
                    {p.points.map(pt => (
                      <li key={pt} className={`flex items-start gap-2.5 text-sm ${hot ? 'text-slate-200' : 'text-slate-700'}`}>
                        <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${hot ? 'text-sky-400' : 'text-sky-500'}`} /> {pt}
                      </li>
                    ))}
                  </ul>
                  <button onClick={goToBook}
                    className={`mt-7 w-full py-3 rounded-full font-semibold text-sm transition-colors cursor-pointer ${hot ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-sky-500 text-white hover:bg-sky-600'}`}>
                    Get a free quote
                  </button>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="text-slate-500 text-xs mt-6 max-w-2xl">
          Plan discounts apply to recurring window cleaning on jobs over $200. One-off cleans start from $200, always quoted free first.
        </p>
      </div>
    </section>
  );
}

// ─── About / why us ──────────────────────────────────────────────────────────

function About() {
  const points = [
    { icon: Shield, text: 'Fully insured, so your place is covered the whole time we are on site.' },
    { icon: Award, text: 'Named 2025 Best Window Cleaner in North Canberra.' },
    { icon: CheckCircle, text: 'Free quotes in writing. The price we send is the price you pay, no surprises on the day.' },
    { icon: Clock, text: 'We turn up when we say we will, and if something is not right we come back and sort it.' },
  ];
  return (
    <section id="about" className="bg-slate-50 border-t border-slate-200 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center">
        <div>
          <Kicker>About us</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3 leading-tight">
            A local team, not a franchise
          </h2>
          <p className="text-slate-600 mt-5 leading-relaxed">
            Glass &amp; Blast is a locally owned and operated business based in North Canberra. We handle every job
            ourselves, so the people you book are the people who turn up and clean your windows. No call centre, no
            subcontractors you have never met.
          </p>
          <p className="text-slate-600 mt-4 leading-relaxed">
            A good deal of our work comes through referrals and repeat customers, and we aim to keep it that way.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <button onClick={goToBook} className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-full transition-colors cursor-pointer">
              Get a free quote
            </button>
            <a href={PHONE_HREF} className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 hover:bg-white text-slate-700 font-semibold rounded-full transition-colors cursor-pointer">
              <Phone className="w-4 h-4 text-sky-500" /> Call {PHONE_DISPLAY}
            </a>
          </div>
        </div>

        <ul className="space-y-4">
          {points.map(p => (
            <li key={p.text} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center">
                <p.icon className="w-5 h-5 text-sky-600" />
              </span>
              <span className="text-slate-600 text-sm leading-relaxed pt-1.5">{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Areas we serve ──────────────────────────────────────────────────────────

const AREA_LINKS: Record<string, string> = { Gungahlin: 'gungahlin', Belconnen: 'belconnen', Dickson: 'dickson', Ainslie: 'ainslie' };

function Areas() {
  const suburbs = ['Gungahlin', 'Belconnen', 'Dickson', 'Braddon', 'Ainslie', 'O\'Connor', 'Lyneham', 'Watson', 'Bruce', 'Turner', 'Reid', 'Civic', 'Hackett', 'Downer'];
  return (
    <section id="areas" className="bg-white border-t border-slate-200 py-16 sm:py-24">
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-[0.8fr_1.2fr] gap-8 lg:gap-12">
        <div>
          <Kicker>Where we work</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3">Areas we cover</h2>
          <p className="text-slate-600 mt-4 leading-relaxed text-sm">
            We cover the whole of the ACT. If you are just outside the ACT we may add a small travel fee, but it is
            case by case, so just ask and we will sort it out with your quote before you book.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 content-start">
          {suburbs.map(s => {
            const slug = AREA_LINKS[s];
            return slug ? (
              <Link key={s} href={`/areas/${slug}`} className="px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-sm hover:text-sky-600 hover:border-sky-300 transition-colors cursor-pointer">
                {s}
              </Link>
            ) : (
              <span key={s} className="px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-sm">
                {s}
              </span>
            );
          })}
          <span className="px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-400 text-sm">
            and the rest of the ACT
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Address autocomplete (free, OpenStreetMap / Nominatim) ──────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function AddressAutocomplete({
  street, onStreet, onSuburb,
}: { street: string; onStreet: (v: string) => void; onSuburb: (v: string) => void }) {
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        setLoading(true);
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=au&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pick = (r: any) => {
    const a = r.address || {};
    const streetVal =
      [a.house_number, a.road].filter(Boolean).join(' ') ||
      a.road ||
      String(r.display_name || '').split(',')[0];
    const suburbVal = a.suburb || a.city || a.town || a.village || a.municipality || a.county || '';
    onStreet(streetVal);
    if (suburbVal) onSuburb(suburbVal);
    setOpen(false);
    setResults([]);
  };

  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
      <input
        className="form-input pl-11"
        placeholder="Start typing your address"
        value={street}
        autoComplete="off"
        onChange={e => { onStreet(e.target.value); query(e.target.value); }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-2 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-300/40">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-slate-900 transition-colors cursor-pointer flex items-start gap-2 border-b border-slate-100 last:border-0"
              >
                <MapPin className="w-3.5 h-3.5 text-sky-500 mt-0.5 flex-shrink-0" />
                <span>{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Book / Contact ──────────────────────────────────────────────────────────

function Book() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [acceptingBookings, setAcceptingBookings] = useState(true);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', service: '', propertyType: '',
    address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '',
  });

  useEffect(() => {
    fetch('/api/settings/public')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data && typeof data.acceptingNewBookings === 'boolean') setAcceptingBookings(data.acceptingNewBookings); })
      .catch(() => {}); // keep the form visible by default if this fails
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const toggleService = (v: string) => setForm(f => {
    const list = f.service ? f.service.split(',') : [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    return { ...f, service: next.join(',') };
  });
  const selectedServices = form.service ? form.service.split(',') : [];

  const canSubmit = form.name && form.phone && form.service && form.address;

  const submit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error('Failed');
      setSubmitted(true);
      toast.success('Thanks, we have got your details and will be in touch.');
    } catch {
      toast.error('Something went wrong. Please call us on 0466 050 834.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="book" className="bg-slate-50 border-t border-slate-200 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-14">
        {/* Left: the pitch + contact details */}
        <div>
          <Kicker>Get a price</Kicker>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-[2.75rem] sm:leading-[1.12] font-bold tracking-tight text-slate-900 mt-3 leading-tight">
            Book a clean or grab a quote
          </h2>
          <p className="text-slate-600 mt-4 leading-relaxed">
            Fill in the form and we will get back to you, usually the same day, with a price. Rather just talk it
            through? Give us a call.
          </p>

          <div className="mt-8 space-y-3">
            <a href={PHONE_HREF} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white shadow-card px-4 py-3.5 hover:border-sky-300 transition-colors cursor-pointer group">
              <span className="w-10 h-10 rounded-md bg-sky-50 flex items-center justify-center flex-shrink-0">
                <Phone className="w-5 h-5 text-sky-600" />
              </span>
              <span>
                <span className="block text-slate-900 font-semibold leading-tight">{PHONE_DISPLAY}</span>
                <span className="block text-slate-500 text-xs mt-0.5">Call or text, 7 days</span>
              </span>
            </a>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white shadow-card px-4 py-3.5">
              <span className="w-10 h-10 rounded-md bg-sky-50 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-sky-600" />
              </span>
              <span>
                <span className="block text-slate-900 font-semibold leading-tight">Canberra, ACT</span>
                <span className="block text-slate-500 text-xs mt-0.5">We cover the whole of the ACT</span>
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white shadow-card px-4 py-3.5">
              <span className="w-10 h-10 rounded-md bg-sky-50 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-sky-600" />
              </span>
              <span>
                <span className="block text-slate-900 font-semibold leading-tight">Open 7 days</span>
                <span className="block text-slate-500 text-xs mt-0.5">Quotes usually back the same day</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right: the form */}
        <div className="light-form rounded-xl border border-slate-200 bg-white shadow-card p-6 sm:p-8">
          {!acceptingBookings ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-5">
                <Clock className="w-8 h-8 text-slate-500" />
              </div>
              <h3 className="font-display text-2xl font-bold text-slate-900">Not currently taking new bookings</h3>
              <p className="text-slate-600 mt-3">We&apos;re fully booked right now. Give us a call and we&apos;ll let you know when we&apos;re free.</p>
              <a href={PHONE_HREF} className="inline-flex items-center gap-2 mt-6 px-6 py-3 border border-slate-200 text-sky-600 font-semibold rounded-full cursor-pointer">
                <Phone className="w-4 h-4" /> Call {PHONE_DISPLAY}
              </a>
            </div>
          ) : submitted ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-8 h-8 text-sky-600" />
              </div>
              <h3 className="font-display text-2xl font-bold text-slate-900">Got it, thanks {form.name.split(' ')[0]}</h3>
              <p className="text-slate-600 mt-3">We have your details and will be in touch shortly to confirm a time and price.</p>
              <a href={PHONE_HREF} className="inline-flex items-center gap-2 mt-6 px-6 py-3 border border-slate-200 text-sky-600 font-semibold rounded-full cursor-pointer">
                <Phone className="w-4 h-4" /> Questions? Call {PHONE_DISPLAY}
              </a>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Who you are */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-600 text-sm font-medium mb-2">Name *</label>
                  <input className="form-input" placeholder="Your name" autoComplete="name" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="block text-slate-600 text-sm font-medium mb-2">Phone *</label>
                  <input className="form-input" type="tel" placeholder="04XX XXX XXX" autoComplete="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
              </div>

              {/* What you need */}
              <div>
                <label className="block text-slate-600 text-sm font-medium mb-2">What do you need? *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'window-washing', l: 'Window cleaning' },
                    { v: 'pressure-washing', l: 'Pressure washing' },
                    { v: 'solar-panel-cleaning', l: 'Solar panels' },
                    { v: 'flyscreen-repair', l: 'Flyscreen repair' },
                    { v: 'other', l: 'Something else' },
                  ].map(o => {
                    const active = selectedServices.includes(o.v);
                    return (
                      <button key={o.v} onClick={() => toggleService(o.v)} className={`px-3 py-3 rounded-md border text-sm font-medium text-left transition-colors cursor-pointer flex items-center gap-2 ${active ? 'border-sky-500 bg-sky-50 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${active ? 'bg-sky-500 border-sky-500' : 'border-slate-300'}`}>
                          {active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </span>
                        {o.l}
                      </button>
                    );
                  })}
                </div>
                {selectedServices.length >= 2 && (
                  <div className="mt-2.5 flex items-start gap-2 text-sky-700 text-xs font-medium bg-sky-50 border border-sky-200 rounded-md px-3 py-2">
                    <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Two or more jobs in one visit gets you a better price. We will factor that into your quote.
                  </div>
                )}
              </div>

              {/* Where */}
              <div>
                <label className="block text-slate-600 text-sm font-medium mb-2">Street address *</label>
                <AddressAutocomplete street={form.address} onStreet={v => set('address', v)} onSuburb={v => set('suburb', v)} />
                <p className="text-slate-500 text-xs mt-1.5">Start typing and pick your address, the suburb fills itself in.</p>
              </div>

              {/* Optional extras, collapsed by default */}
              {!showExtras ? (
                <button onClick={() => setShowExtras(true)} className="text-sky-600 hover:text-sky-700 text-sm font-medium cursor-pointer">
                  + Add a preferred day, email or notes (optional)
                </button>
              ) : (
                <div className="space-y-4 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 text-sm font-medium mb-2">Preferred date</label>
                      <input className="form-input" type="date" min={new Date(Date.now() + 86400000).toISOString().split('T')[0]} value={form.preferredDate} onChange={e => set('preferredDate', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-sm font-medium mb-2">Preferred time</label>
                      <input className="form-input" placeholder="Morning, 9am…" value={form.preferredTime} onChange={e => set('preferredTime', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-600 text-sm font-medium mb-2">Email</label>
                    <input className="form-input" type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-sm font-medium mb-2">Anything else</label>
                    <textarea className="form-input resize-none" rows={2} placeholder="Number of windows, access notes, anything we should know" value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </div>
                </div>
              )}

              <button disabled={!canSubmit || loading} onClick={submit} className="w-full py-4 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-full transition-colors cursor-pointer flex items-center justify-center gap-2">
                {loading ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending</>) : 'Get my free quote'}
              </button>

              <p className="text-center text-slate-500 text-xs">
                No obligation, we call you back with a price. Prefer to talk now? <a href={PHONE_HREF} className="text-sky-600 hover:underline">{PHONE_DISPLAY}</a>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Sticky mobile CTA (call / book always one tap away) ────────────────────

function StickyCTA() {
  const [show, setShow] = useState(false);
  const [bookVisible, setBookVisible] = useState(false);
  const [nearBottom, setNearBottom] = useState(false);

  useEffect(() => {
    // Hide once the footer is basically in view — otherwise this bar re-appears
    // over the footer (covering the admin "Sign in" link) since #book is long
    // scrolled past by then and stops driving visibility on its own.
    const onScroll = () => {
      setShow(window.scrollY > 500);
      const fromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      setNearBottom(fromBottom < 400);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    const book = document.querySelector('#book');
    let io: IntersectionObserver | null = null;
    if (book) {
      io = new IntersectionObserver(([e]) => setBookVisible(e.isIntersecting), { threshold: 0.15 });
      io.observe(book);
    }
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); io?.disconnect(); };
  }, []);

  const visible = show && !bookVisible && !nearBottom;

  return (
    <div className={`md:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'}`}>
      <div className="bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] px-4 pt-3 safe-bottom pb-3">
        <div className="flex gap-2.5">
          <a href={PHONE_HREF} className="flex-1 inline-flex items-center justify-center gap-2 py-3 border border-slate-300 text-slate-800 font-semibold text-sm rounded-full cursor-pointer">
            <Phone className="w-4 h-4 text-sky-500" /> Call us
          </a>
          <button onClick={goToBook} className="flex-[1.4] py-3 bg-sky-500 text-white font-semibold text-sm rounded-full cursor-pointer">
            Get a free quote
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sky CTA band (commit-to-color) ──────────────────────────────────────────

function SkyCTA() {
  return (
    <section className="bg-navy-900">
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-20 flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div>
          <h2 className="font-display text-[1.9rem] leading-[1.15] sm:text-4xl font-bold tracking-tight text-white">Ready for clear windows?</h2>
          <p className="text-slate-400 mt-3">Free quote, usually back the same day. Right across the ACT.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
          <button onClick={goToBook} className="px-7 py-3.5 bg-sky-500 text-white font-semibold rounded-full hover:bg-sky-400 transition-colors cursor-pointer">
            Get a free quote
          </button>
          <a href={PHONE_HREF} className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/25 hover:bg-white/10 text-white font-semibold rounded-full transition-colors cursor-pointer">
            <Phone className="w-4 h-4 text-sky-400" /> Call {PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Footer (kept dark — anchors the light page, hides bottom overscroll) ────

function Footer() {
  return (
    <footer className="bg-navy-900 border-t border-white/10 pt-12 pb-8">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1">
            <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={170} height={68} className="object-contain h-14 w-auto" />
            <p className="text-slate-400 text-sm mt-4 leading-relaxed">
              Window cleaning and pressure washing across the ACT. Locally owned, fully insured.
            </p>
            <div className="flex gap-2.5 mt-4">
              <a href="https://www.facebook.com/profile.php?id=61573538586021" target="_blank" rel="noopener noreferrer" aria-label="Glass & Blast on Facebook" className="w-9 h-9 rounded-md border border-white/10 flex items-center justify-center text-slate-400 hover:text-sky-400 hover:border-sky-400/40 transition-colors cursor-pointer">
                <Facebook className="w-4 h-4" />
              </a>
              <a href="https://www.google.com/maps/place/Glass+%26+Blast+Canberra/@-35.2641588,149.1323995,17z" target="_blank" rel="noopener noreferrer" aria-label="Glass & Blast on Google" className="w-9 h-9 rounded-md border border-white/10 flex items-center justify-center hover:border-sky-400/40 transition-colors cursor-pointer">
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-white text-sm font-semibold">Get in touch</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><a href={PHONE_HREF} className="hover:text-sky-400 transition-colors">{PHONE_DISPLAY}</a></li>
              <li>info@glassandblast.com.au</li>
              <li>Open 7 days, quotes back the same day</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white text-sm font-semibold">Services</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><button onClick={() => smoothScrollTo('#services')} className="hover:text-sky-400 transition-colors cursor-pointer">Window cleaning</button></li>
              <li><a href="/services/pressure-washing-canberra" className="hover:text-sky-400 transition-colors">Pressure washing</a></li>
              <li><a href="/services/commercial-window-cleaning-canberra" className="hover:text-sky-400 transition-colors">Commercial</a></li>
              <li><a href="/faq" className="hover:text-sky-400 transition-colors">FAQ</a></li>
              <li><a href="/blog" className="hover:text-sky-400 transition-colors">Window cleaning guides</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white text-sm font-semibold">Areas</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><Link href="/areas/gungahlin" className="hover:text-sky-400 transition-colors">Window cleaning Gungahlin</Link></li>
              <li><Link href="/areas/belconnen" className="hover:text-sky-400 transition-colors">Window cleaning Belconnen</Link></li>
              <li><Link href="/areas/dickson" className="hover:text-sky-400 transition-colors">Window cleaning Dickson</Link></li>
              <li><Link href="/areas/ainslie" className="hover:text-sky-400 transition-colors">Window cleaning Ainslie</Link></li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">Right across the ACT. ABN on request.</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500 text-xs">
          <span>© {new Date().getFullYear()} Glass &amp; Blast Window Cleaning</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><Award className="w-3.5 h-3.5 text-sky-400" /> 2025 Best Window Cleaner, North Canberra</span>
            <a href="/admin" className="flex items-center gap-1 hover:text-sky-400 transition-colors cursor-pointer"><Lock className="w-3 h-3" /> Sign in</a>
            <a href="/privacy" className="hover:text-sky-400 transition-colors">Privacy</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="bg-white">
        <Hero />
        <TrustStrip />
        <Work />
        <Services />
        <HowItWorks />
        <Plans />
        <Reviews />
        <About />
        <Areas />
        <SkyCTA />
        <Book />
      </main>
      <StickyCTA />
      <Footer />
    </>
  );
}
