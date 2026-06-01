'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import toast from 'react-hot-toast';
import {
  Phone, MapPin, Star, Award, CheckCircle, Clock, Shield,
  Sparkles, ChevronDown, Menu, X, ArrowRight, Droplets, Wind,
  ThumbsUp, Users, Calendar, Zap, Facebook, Lock, Search
} from 'lucide-react';
import Reviews from '@/components/Reviews';

// ─── Constants ─────────────────────────────────────────────────────────────

const SERVICES = [
  {
    id: 'window-washing',
    icon: Droplets,
    title: 'Window Washing',
    description: 'Crystal-clear, streak-free results for every pane. We use professional-grade equipment and eco-safe solutions.',
    features: ['Residential & Commercial', 'Interior & Exterior', 'Screen cleaning included', 'Frame & sill wipe-down', 'Eco-safe solutions'],
    color: 'from-sky-500/20 to-blue-500/10',
    accent: '#38BDF8',
    photo: '/work-window-pole.jpg',
    photoAlt: 'Glass & Blast team cleaning high windows with an extension pole',
    objectPos: 'center 72%',
  },
  {
    id: 'pressure-washing',
    icon: Wind,
    title: 'Pressure Washing',
    description: 'High-power cleaning that blasts away grime, mould, and stains from driveways, paths, and exterior surfaces.',
    features: ['Driveways & Paths', 'Decks & Patios', 'Building Exteriors', 'Fences & Walls', 'Safe for all surfaces'],
    color: 'from-indigo-500/20 to-purple-500/10',
    accent: '#818CF8',
    photo: '/work-pressure-wash.jpg',
    photoAlt: 'Freshly pressure-washed brick pathway, before and after results',
    objectPos: 'center 60%',
  },
];

const NAV_LINKS = [
  { label: 'Services', href: '#services' },
  { label: 'About', href: '#about' },
  { label: 'Reviews', href: '#reviews' },
  { label: 'Contact', href: '#contact' },
];

// ─── Animation variants ─────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function StarRating({ count = 5 }: { count?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sky-400 text-sm font-semibold tracking-widest uppercase">
      <span className="w-6 h-px bg-sky-400" />
      {children}
      <span className="w-6 h-px bg-sky-400" />
    </span>
  );
}

function AnimatedCounter({ target, suffix = '', duration = 2 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = target / (duration * 60);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 1000 / 60);
    return () => clearInterval(timer);
  }, [inView, target, duration]);

  return <span ref={ref}>{count}{suffix}</span>;
}

// ─── Navbar ─────────────────────────────────────────────────────────────────

function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const scrollTo = (href: string) => {
    setOpen(false);
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <motion.nav
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-3 left-3 right-3 sm:top-4 sm:left-4 sm:right-4 z-50 mx-auto max-w-6xl rounded-2xl transition-all duration-500 ${
        scrolled || open ? 'md:bg-navy-900/5 md:backdrop-blur-md md:border md:border-white/5 md:shadow-lg md:shadow-black/10' : 'bg-transparent'
      }`}
    >
      <div className="pl-4 pr-3 py-1.5 sm:px-6 sm:py-2 flex items-center justify-between">
        {/* Logo */}
        <button onClick={() => scrollTo('#hero')} className="flex items-center cursor-pointer">
          <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={360} height={144} className="object-contain h-[4.55rem] sm:h-20 md:h-[7.2rem] w-auto drop-shadow-lg" priority />
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(l => (
            <button
              key={l.href}
              onClick={() => scrollTo(l.href)}
              className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium rounded-xl hover:bg-white/5 transition-all duration-200 cursor-pointer"
            >
              {l.label}
            </button>
          ))}
          <a href="/faq" className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium rounded-xl hover:bg-white/5 transition-all duration-200 cursor-pointer">
            FAQ
          </a>
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a href="tel:+61466050834" className="flex items-center gap-2 text-sky-400 text-sm font-medium hover:text-sky-300 transition-colors cursor-pointer">
            <Phone className="w-4 h-4" />
            0466 050 834
          </a>
          <button
            onClick={() => scrollTo('#booking')}
            className="relative px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-sky-500/30 hover:-translate-y-0.5 cursor-pointer"
          >
            Book Now
          </button>
        </div>

        {/* Mobile toggle — small frosted floating button */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Menu"
          className="md:hidden p-2.5 rounded-xl bg-navy-900/40 backdrop-blur-md border border-white/10 shadow-lg shadow-black/30 text-white cursor-pointer active:scale-95 transition-transform"
        >
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="block">
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </motion.span>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden overflow-hidden mt-2 rounded-2xl bg-navy-900/60 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40 px-6 py-4 flex flex-col gap-2"
          >
            {NAV_LINKS.map(l => (
              <button key={l.href} onClick={() => scrollTo(l.href)} className="py-2.5 text-left text-slate-300 hover:text-white text-sm font-medium cursor-pointer">
                {l.label}
              </button>
            ))}
            <a href="/faq" className="py-2.5 text-left text-slate-300 hover:text-white text-sm font-medium cursor-pointer">FAQ</a>
            <div className="pt-2 border-t border-white/10 flex flex-col gap-2">
              <a href="tel:+61466050834" className="flex items-center gap-2 py-2.5 text-sky-400 text-sm font-medium">
                <Phone className="w-4 h-4" /> 0466 050 834
              </a>
              <button onClick={() => scrollTo('#booking')} className="px-5 py-2.5 bg-sky-500 text-white text-sm font-semibold rounded-xl cursor-pointer">
                Book Now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────

function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Slow-motion autoplay loop
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = 0.6;
    const onMeta = () => { v.playbackRate = 0.6; };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, []);

  return (
    <section id="hero" className="relative min-h-[100svh] flex flex-col items-center justify-start sm:justify-center overflow-hidden">
      {/* Background — video + overlays */}
      <div className="absolute inset-0">
        {/* Hero video — slow-motion autoplay, zoomed out */}
        <video
          ref={videoRef}
          autoPlay muted loop playsInline preload="auto"
          className="absolute inset-0 w-full h-full object-cover opacity-60 scale-100 translate-y-0 md:scale-[0.88] md:translate-y-[7%]"
          poster="/work-window-pole.jpg"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        {/* Uniform tint for legibility (symmetric) */}
        <div className="absolute inset-0 bg-navy-900/35" />
        {/* Blue hue — blends the video into the brand palette */}
        <div className="absolute inset-0 bg-sky-600/15 mix-blend-soft-light" />
        <div className="absolute inset-0 bg-[#0b2d52]/20" />
        {/* Premium rectangular vignette — strong edges, very quick yet eased fade (no visible line) */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to right, #060D1A 0%, #060D1A 3%, rgba(6,13,26,0.6) 7%, rgba(6,13,26,0.15) 11%, transparent 14%, transparent 86%, rgba(6,13,26,0.15) 89%, rgba(6,13,26,0.6) 93%, #060D1A 97%, #060D1A 100%), linear-gradient(to bottom, #060D1A 0%, #060D1A 3%, rgba(6,13,26,0.6) 7%, rgba(6,13,26,0.15) 11%, transparent 14%, transparent 86%, rgba(6,13,26,0.15) 89%, rgba(6,13,26,0.6) 93%, #060D1A 97%, #060D1A 100%)' }}
        />
        {/* Solid bottom — Services section hands off onto solid colour */}
        <div className="absolute inset-x-0 bottom-0 h-1/4 pointer-events-none bg-gradient-to-t from-navy-900 via-navy-900/85 to-transparent" />
        {/* Radial glows */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl" />
        {/* Grid */}
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)', backgroundSize: '60px 60px' }}
        />
      </div>

      {/* Floating glass panels */}
      <motion.div
        animate={{ y: [0, -20, 0], rotate: [0, 2, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-24 right-[10%] w-24 h-32 rounded-2xl glass border border-sky-400/20 shadow-xl shadow-sky-500/10 hidden lg:block"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-sky-400/10 to-transparent rounded-2xl" />
        <div className="absolute top-3 left-3 right-3 h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />
      </motion.div>
      <motion.div
        animate={{ y: [0, 16, 0], rotate: [0, -2, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-32 left-[8%] w-20 h-28 rounded-2xl glass border border-sky-400/10 hidden lg:block"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 to-transparent rounded-2xl" />
      </motion.div>
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute top-1/2 right-[5%] w-16 h-20 rounded-xl glass border border-white/10 hidden xl:block"
      />

      {/* Award badge */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="absolute top-28 right-6 lg:right-[18%] glass border border-amber-400/30 rounded-2xl px-4 py-3 hidden sm:flex flex-col items-center gap-1 shadow-xl shadow-amber-500/10"
      >
        <Award className="w-5 h-5 text-amber-400" />
        <div className="text-amber-400 text-[10px] font-bold tracking-wider text-center">BEST WINDOW<br />CLEANER 2025</div>
        <div className="text-slate-400 text-[9px]">North Canberra</div>
      </motion.div>

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center pt-24">
        <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center gap-6">

          <motion.div variants={fadeUp}>
            <span className="inline-flex items-center gap-2 bg-sky-400/10 border border-sky-400/20 text-sky-400 text-xs font-semibold tracking-wider px-4 py-2 rounded-full uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              Award-Winning Window Cleaning · Canberra
            </span>
          </motion.div>

          <motion.h1 variants={fadeUp} className="font-display text-4xl sm:text-6xl lg:text-7xl xl:text-8xl font-bold leading-[1.08] sm:leading-[1.05] tracking-tight">
            <span className="text-white">Canberra&apos;s</span>
            <br />
            <span className="text-gradient">#1 Window</span>
            <br />
            <span className="text-white">Cleaning Service</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-slate-400 text-base sm:text-xl max-w-2xl leading-relaxed">
            Professional, award-winning window washing and pressure cleaning for residential and commercial properties across Canberra. Streak-free results, every time.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto">
            <button
              onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
              className="relative group inline-flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-2xl transition-all duration-300 hover:shadow-xl hover:shadow-sky-500/40 hover:-translate-y-1 cursor-pointer text-base"
            >
              <Calendar className="w-5 h-5" />
              Book a Free Quote
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href="tel:+61466050834"
              className="inline-flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 glass hover:bg-white/8 text-white font-semibold rounded-2xl transition-all duration-300 border border-white/10 hover:border-sky-400/30 cursor-pointer text-base"
            >
              <Phone className="w-5 h-5 text-sky-400" />
              0466 050 834
            </a>
          </motion.div>

          {/* Social proof row */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-2 text-xs sm:text-sm">
            <div className="flex items-center gap-1.5">
              <StarRating />
              <span className="text-white font-semibold">5.0</span>
              <span className="text-slate-500">across all platforms</span>
            </div>
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-slate-400">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              Top 1% of Australian businesses
            </div>
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
              24/7 availability
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-8 hidden sm:flex flex-col items-center gap-2 text-slate-500 cursor-pointer"
        onClick={() => document.querySelector('#services')?.scrollIntoView({ behavior: 'smooth' })}
      >
        <span className="text-xs tracking-widest uppercase">Scroll</span>
        <ChevronDown className="w-5 h-5" />
      </motion.div>
    </section>
  );
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });

  const stats = [
    { icon: Award, label: 'Best Window Cleaner', value: '2025', suffix: '', desc: 'North Canberra Award' },
    { icon: ThumbsUp, label: 'Quality Score', value: 95, suffix: '%+', desc: 'Top 1% of Australian businesses' },
    { icon: Star, label: 'Rating', value: 5, suffix: '★', desc: 'Across all platforms' },
    { icon: Users, label: 'Happy Customers', value: 200, suffix: '+', desc: 'And growing' },
  ];

  return (
    <section ref={ref} className="relative bg-gradient-to-r from-sky-600/90 to-blue-700/90 py-12 overflow-hidden">
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
      />
      <div className="relative max-w-6xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-8">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 30 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-center text-white"
          >
            <s.icon className="w-7 h-7 mx-auto mb-2 opacity-80" />
            <div className="font-display text-3xl sm:text-4xl font-bold">
              {typeof s.value === 'number' && inView
                ? <AnimatedCounter target={s.value} suffix={s.suffix} />
                : `${s.value}${s.suffix}`}
            </div>
            <div className="font-semibold text-sm mt-1">{s.label}</div>
            <div className="text-blue-100 text-xs mt-0.5">{s.desc}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Services ────────────────────────────────────────────────────────────────

function Services() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="services" ref={ref} className="py-16 sm:py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-900 to-navy-800" />
      <div className="relative max-w-6xl mx-auto px-6">
        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="text-center mb-16">
          <motion.div variants={fadeUp}><SectionLabel>Our Services</SectionLabel></motion.div>
          <motion.h2 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold text-white mt-4">
            Everything Your Property Needs
          </motion.h2>
          <motion.p variants={fadeUp} className="text-slate-400 text-lg mt-4 max-w-xl mx-auto">
            Professional cleaning services tailored for Canberra homes and businesses.
          </motion.p>
        </motion.div>

        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="grid md:grid-cols-2 gap-8">
          {SERVICES.map((svc) => (
            <motion.div
              key={svc.id}
              variants={scaleIn}
              whileHover={{ y: -6, transition: { duration: 0.3 } }}
              className={`glass rounded-3xl border border-white/8 bg-gradient-to-br ${svc.color} group cursor-default overflow-hidden`}
            >
              {/* Photo — fills frame, fades seamlessly into card body */}
              <div className="relative h-72 sm:h-96 w-full overflow-hidden">
                <Image
                  src={svc.photo}
                  alt={svc.photoAlt}
                  fill
                  style={{ objectPosition: svc.objectPos }}
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                {/* Subtle fade into the card content below */}
                <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0d1a2c]/90 to-transparent" />
                {/* Icon badge */}
                <div className="absolute bottom-4 left-4 w-11 h-11 rounded-xl flex items-center justify-center shadow-lg z-10"
                  style={{ background: `${svc.accent}25`, border: `1px solid ${svc.accent}40`, backdropFilter: 'blur(8px)' }}>
                  <svc.icon className="w-6 h-6" style={{ color: svc.accent }} />
                </div>
              </div>

              {/* Content */}
              <div className="p-8">
                <h3 className="font-display text-2xl font-bold text-white mb-3">{svc.title}</h3>
                <p className="text-slate-400 mb-6 leading-relaxed">{svc.description}</p>

                <ul className="space-y-2.5">
                  {svc.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-slate-300 text-sm">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: svc.accent }} />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
                  className="mt-8 w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
                  style={{ background: `${svc.accent}20`, color: svc.accent, border: `1px solid ${svc.accent}30` }}
                >
                  Get a Free Quote →
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Combined service callout */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate={inView ? 'show' : 'hidden'}
          transition={{ delay: 0.4 }}
          className="mt-8 glass rounded-2xl border border-sky-400/20 px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-sky-400/15 flex items-center justify-center">
              <Zap className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <div className="text-white font-semibold">Bundle & Save</div>
              <div className="text-slate-400 text-sm">Book both window washing + pressure washing and get a better rate</div>
            </div>
          </div>
          <button
            onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex-shrink-0 px-6 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-500/30 cursor-pointer"
          >
            Book Bundle
          </button>
        </motion.div>
      </div>
    </section>
  );
}

// ─── About / Why Us ─────────────────────────────────────────────────────────

function WhyUs() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  const reasons = [
    { icon: Award, title: 'Award-Winning', desc: 'Named 2025 Best Window Cleaner in North Canberra by Quality Business Awards.' },
    { icon: Shield, title: 'Fully Insured', desc: 'Fully insured and professional team. Your property is protected at all times.' },
    { icon: Clock, title: 'Always On Time', desc: 'We respect your schedule. Punctual arrivals, every single appointment.' },
    { icon: Sparkles, title: 'Streak-Free Results', desc: 'Professional-grade equipment and eco-safe solutions for crystal-clear windows.' },
    { icon: ThumbsUp, title: 'Fair Pricing', desc: 'Transparent, competitive pricing with no hidden fees. Free quotes always.' },
    { icon: MapPin, title: 'Locally Owned', desc: 'Proudly Canberran. We know the area and care about our community.' },
  ];

  return (
    <section id="about" ref={ref} className="py-16 sm:py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-800 to-navy-900" />
      <div className="absolute right-0 top-1/4 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'}>
            <motion.div variants={fadeUp}><SectionLabel>Why Choose Us</SectionLabel></motion.div>
            <motion.h2 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold text-white mt-4 leading-tight">
              The Meticulous Local Team That Punches Above Its Weight
            </motion.h2>
            <motion.p variants={fadeUp} className="text-slate-400 mt-6 leading-relaxed text-lg">
              Glass & Blast is a locally owned and operated Canberra business built on one promise: we will not leave until you are 100% satisfied. Our award-winning team brings professional-grade equipment and genuine care to every job.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-col sm:flex-row gap-4">
              <button
                onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center gap-2 px-6 py-3.5 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-500/30 cursor-pointer"
              >
                <Calendar className="w-4 h-4" /> Get a Free Quote
              </button>
              <a
                href="tel:+61466050834"
                className="inline-flex items-center gap-2 px-6 py-3.5 glass border border-white/10 hover:border-sky-400/30 text-white font-semibold rounded-xl transition-all cursor-pointer"
              >
                <Phone className="w-4 h-4 text-sky-400" /> Call Us Now
              </a>
            </motion.div>
          </motion.div>

          {/* Right: grid of reasons */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate={inView ? 'show' : 'hidden'}
            className="grid grid-cols-2 gap-4"
          >
            {reasons.map((r, i) => (
              <motion.div
                key={r.title}
                variants={fadeUp}
                transition={{ delay: i * 0.08 }}
                className="glass rounded-2xl p-5 border border-white/8 hover:border-sky-400/20 transition-all duration-300 group"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-400/10 flex items-center justify-center mb-3 group-hover:bg-sky-400/20 transition-colors">
                  <r.icon className="w-5 h-5 text-sky-400" />
                </div>
                <div className="font-display font-semibold text-white text-sm mb-1">{r.title}</div>
                <div className="text-slate-500 text-xs leading-relaxed">{r.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Our Work Gallery ────────────────────────────────────────────────────────

function OurWork() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  const shots = [
    {
      src: '/work-squeegee.jpg',
      alt: 'Close-up of squeegee leaving a streak-free finish on a Canberra window',
      label: 'Window Washing',
      tag: 'Residential',
      accent: '#38BDF8',
    },
    {
      src: '/work-pressure-wash.jpg',
      alt: 'Pressure-washed brick pathway, sparkling clean result',
      label: 'Pressure Washing',
      tag: 'Driveway & Paths',
      accent: '#818CF8',
    },
  ];

  return (
    <section ref={ref} className="py-16 sm:py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-900 to-navy-800" />
      {/* subtle diagonal pattern */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #38BDF8 0, #38BDF8 1px, transparent 0, transparent 50%)', backgroundSize: '24px 24px' }}
      />

      <div className="relative max-w-6xl mx-auto px-6">
        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="text-center mb-14">
          <motion.div variants={fadeUp}><SectionLabel>Our Work</SectionLabel></motion.div>
          <motion.h2 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold text-white mt-4">
            Results That Speak for Themselves
          </motion.h2>
          <motion.p variants={fadeUp} className="text-slate-400 mt-4 max-w-xl mx-auto">
            Every job we do is a showcase. Here&apos;s a glimpse of our team in action across Canberra.
          </motion.p>
        </motion.div>

        {/* Main gallery grid */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate={inView ? 'show' : 'hidden'}
          className="grid md:grid-cols-2 gap-6"
        >
          {shots.map((shot, i) => (
            <motion.div
              key={shot.src}
              variants={fadeUp}
              transition={{ delay: i * 0.15 }}
              className="group relative overflow-hidden rounded-3xl border border-white/8"
              whileHover={{ scale: 1.01, transition: { duration: 0.3 } }}
            >
              <div className="relative aspect-[5/4] w-full">
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  className="object-cover object-center transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                {/* Overlay — bottom only, keeps label readable */}
                <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-navy-900 via-navy-900/60 to-transparent transition-opacity duration-300" />

                {/* Bottom label */}
                <div className="absolute bottom-0 left-0 right-0 p-6 translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full mb-2 inline-block backdrop-blur-sm"
                        style={{ background: `rgba(6,13,26,0.78)`, color: shot.accent, border: `1px solid ${shot.accent}55` }}>
                        {shot.tag}
                      </span>
                      <h3 className="font-display text-xl font-bold text-white">{shot.label}</h3>
                      <p className="text-slate-400 text-sm mt-1">Canberra, ACT</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
                      className="flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all"
                      style={{ background: `${shot.accent}20`, color: shot.accent, border: `1px solid ${shot.accent}30` }}
                    >
                      Book This →
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA strip below gallery */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate={inView ? 'show' : 'hidden'}
          transition={{ delay: 0.4 }}
          className="mt-10 text-center"
        >
          <p className="text-slate-500 text-sm mb-4">Want results like these? Get a free quote today.</p>
          <button
            onClick={() => document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' })}
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-500/30 cursor-pointer"
          >
            <Calendar className="w-4 h-4" /> Book a Free Quote
          </button>
        </motion.div>
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
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none z-10" />
      <input
        className="form-input pl-11"
        placeholder="Start typing your address…"
        value={street}
        autoComplete="off"
        onChange={e => { onStreet(e.target.value); query(e.target.value); }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20 border-t-sky-400 rounded-full animate-spin" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-2 w-full max-h-64 overflow-auto rounded-xl border border-white/10 bg-navy-800/95 backdrop-blur-xl shadow-2xl shadow-black/50">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-sky-400/10 hover:text-white transition-colors cursor-pointer flex items-start gap-2 border-b border-white/5 last:border-0"
              >
                <MapPin className="w-3.5 h-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                <span>{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Booking Form ────────────────────────────────────────────────────────────

function BookingForm() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', service: '', propertyType: '',
    address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '',
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const canStep1 = form.name && form.email && form.phone;
  const canStep2 = form.service && form.propertyType;
  const canStep3 = form.address && form.suburb && form.preferredDate && form.preferredTime;

  const submit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error('Failed');
      setSubmitted(true);
      toast.success('Booking submitted! We\'ll be in touch shortly.');
    } catch {
      toast.error('Something went wrong. Please call us directly.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <section id="booking" ref={ref} className="py-16 sm:py-24 lg:py-32 bg-gradient-to-b from-navy-900 to-navy-800">
        <div className="max-w-xl mx-auto px-6 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.4 }}>
            <div className="w-20 h-20 rounded-full bg-emerald-400/15 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="font-display text-3xl font-bold text-white mb-4">Booking Received!</h2>
            <p className="text-slate-400 text-lg">Thanks {form.name.split(' ')[0]}! We&apos;ve received your booking request and will be in touch shortly to confirm your appointment.</p>
            <a href="tel:+61466050834" className="inline-flex items-center gap-2 mt-8 px-6 py-3 glass border border-white/10 text-sky-400 font-semibold rounded-xl cursor-pointer">
              <Phone className="w-4 h-4" /> Questions? Call us: 0466 050 834
            </a>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section id="booking" ref={ref} className="py-16 sm:py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-800 to-navy-900" />
      <div className="absolute inset-0 opacity-40"
        style={{ backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(14,165,233,0.06) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-2xl mx-auto px-6">
        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="text-center mb-12">
          <motion.div variants={fadeUp}><SectionLabel>Get a Quote</SectionLabel></motion.div>
          <motion.h2 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold text-white mt-4">
            Book Your Clean
          </motion.h2>
          <motion.p variants={fadeUp} className="text-slate-400 mt-4">
            Takes 2 minutes. We&apos;ll be in touch to confirm.
          </motion.p>
        </motion.div>

        {/* Progress */}
        <motion.div variants={fadeUp} initial="hidden" animate={inView ? 'show' : 'hidden'} className="flex items-center gap-3 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-3 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 flex-shrink-0 ${
                step > s ? 'bg-emerald-400 text-navy-900' : step === s ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-500'
              }`}>
                {step > s ? '✓' : s}
              </div>
              <div className={`text-xs font-medium ${step >= s ? 'text-white' : 'text-slate-600'}`}>
                {s === 1 ? 'Your Details' : s === 2 ? 'Service' : 'Schedule'}
              </div>
              {s < 3 && <div className={`flex-1 h-px transition-all duration-500 ${step > s ? 'bg-sky-400' : 'bg-white/10'}`} />}
            </div>
          ))}
        </motion.div>

        <motion.div variants={scaleIn} initial="hidden" animate={inView ? 'show' : 'hidden'} className="glass rounded-3xl border border-white/10 p-8">
          <AnimatePresence mode="wait">

            {/* Step 1: Contact */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Full Name *</label>
                  <input className="form-input" placeholder="John Smith" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Email Address *</label>
                  <input className="form-input" type="email" placeholder="john@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Phone Number *</label>
                  <input className="form-input" type="tel" placeholder="04XX XXX XXX" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <button disabled={!canStep1} onClick={() => setStep(2)} className="w-full py-3.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all hover:-translate-y-0.5 cursor-pointer">
                  Next: Choose Service →
                </button>
              </motion.div>
            )}

            {/* Step 2: Service */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-3">Service Required *</label>
                  <div className="grid gap-3">
                    {[
                      { v: 'window-washing', l: 'Window Washing', d: 'Streak-free interior & exterior cleaning' },
                      { v: 'pressure-washing', l: 'Pressure Washing', d: 'Driveways, paths, exterior surfaces' },
                      { v: 'both', l: 'Both Services', d: 'Bundle deal – best value' },
                    ].map(o => (
                      <button
                        key={o.v}
                        onClick={() => set('service', o.v)}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          form.service === o.v ? 'border-sky-400 bg-sky-400/10 text-white' : 'border-white/10 bg-white/3 text-slate-300 hover:border-white/20'
                        }`}
                      >
                        <div className="font-semibold text-sm">{o.l}</div>
                        <div className="text-xs opacity-70 mt-0.5">{o.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-3">Property Type *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['residential', 'commercial'].map(t => (
                      <button
                        key={t}
                        onClick={() => set('propertyType', t)}
                        className={`p-3 rounded-xl border text-sm font-medium capitalize transition-all cursor-pointer ${
                          form.propertyType === t ? 'border-sky-400 bg-sky-400/10 text-white' : 'border-white/10 bg-white/3 text-slate-300 hover:border-white/20'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="px-5 py-3 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white transition-all cursor-pointer">
                    ← Back
                  </button>
                  <button disabled={!canStep2} onClick={() => setStep(3)} className="flex-1 py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all cursor-pointer">
                    Next: Schedule →
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Schedule */}
            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Street Address *</label>
                  <AddressAutocomplete
                    street={form.address}
                    onStreet={v => set('address', v)}
                    onSuburb={v => set('suburb', v)}
                  />
                  <p className="text-slate-600 text-xs mt-1.5">Start typing and pick your address, and your suburb fills in automatically.</p>
                </div>
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Suburb *</label>
                  <input className="form-input" placeholder="Suburb" value={form.suburb} onChange={e => set('suburb', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 text-sm font-medium mb-2">Preferred Date *</label>
                    <input
                      className="form-input"
                      type="date"
                      min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                      value={form.preferredDate}
                      onChange={e => set('preferredDate', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-sm font-medium mb-2">Preferred Time *</label>
                    <input className="form-input" placeholder="e.g. Morning, 9am, or no preference" value={form.preferredTime} onChange={e => set('preferredTime', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Additional Notes</label>
                  <textarea className="form-input resize-none" rows={3} placeholder="Number of windows, special requirements, access notes..." value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(2)} className="px-5 py-3 glass border border-white/10 text-slate-400 text-sm rounded-xl hover:text-white transition-all cursor-pointer">
                    ← Back
                  </button>
                  <button disabled={!canStep3 || loading} onClick={submit} className="flex-1 py-3.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-500/30 cursor-pointer flex items-center justify-center gap-2">
                    {loading ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting...</>
                    ) : (
                      <><CheckCircle className="w-4 h-4" /> Submit Booking Request</>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.p variants={fadeUp} initial="hidden" animate={inView ? 'show' : 'hidden'} className="text-center text-slate-600 text-xs mt-6">
          Prefer to call? Reach us on <a href="tel:+61466050834" className="text-sky-400 hover:underline">0466 050 834</a>, available 24/7.
        </motion.p>
      </div>
    </section>
  );
}

// ─── Contact ─────────────────────────────────────────────────────────────────

function Contact() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="contact" ref={ref} className="py-16 sm:py-24 lg:py-32 bg-gradient-to-b from-navy-900 to-navy-900">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="text-center mb-16">
          <motion.div variants={fadeUp}><SectionLabel>Contact</SectionLabel></motion.div>
          <motion.h2 variants={fadeUp} className="font-display text-4xl sm:text-5xl font-bold text-white mt-4">Get in Touch</motion.h2>
        </motion.div>

        <motion.div variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {[
            { icon: Phone, label: 'Phone', value: '0466 050 834', sub: 'Available 24/7', href: 'tel:+61466050834', accent: '#38BDF8' },
            { icon: MapPin, label: 'Location', value: 'North Canberra, ACT', sub: 'Serving greater Canberra', href: 'https://maps.google.com/?q=North+Canberra+ACT', accent: '#34D399' },
          ].map((c, i) => (
            <motion.a
              key={c.label}
              href={c.href}
              target={c.href.startsWith('http') ? '_blank' : undefined}
              rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              variants={scaleIn}
              transition={{ delay: i * 0.1 }}
              className="glass rounded-2xl border border-white/8 p-6 text-center hover:border-sky-400/20 transition-all duration-300 group hover:-translate-y-1 cursor-pointer block"
            >
              <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110"
                style={{ background: `${c.accent}15`, border: `1px solid ${c.accent}20` }}>
                <c.icon className="w-6 h-6" style={{ color: c.accent }} />
              </div>
              <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">{c.label}</div>
              <div className="text-white font-semibold">{c.value}</div>
              <div className="text-slate-500 text-sm mt-1">{c.sub}</div>
            </motion.a>
          ))}
        </motion.div>

        {/* Areas we serve — local SEO relevance */}
        <motion.div variants={fadeUp} initial="hidden" animate={inView ? 'show' : 'hidden'} className="mt-12 text-center">
          <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">Areas We Serve in Canberra</h3>
          <p className="text-slate-500 text-sm max-w-3xl mx-auto leading-relaxed">
            Dickson, Braddon, Ainslie, Bruce, Gungahlin, Belconnen, Civic, Reid, Turner, O&apos;Connor, Acton,
            Yarralumla, Deakin, Barton, Forrest, Narrabundah and surrounding suburbs across the ACT.
          </p>
          <p className="text-slate-500 text-sm max-w-2xl mx-auto leading-relaxed mt-3">
            We also take bookings outside the ACT. A small travel fee may apply depending on the location, and we will always confirm it with your quote.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-navy-900 border-t border-white/5 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={150} height={60} className="object-contain h-14 w-auto" />
            <div className="hidden sm:block">
              <div className="text-slate-400 text-xs">North Canberra, ACT · ABN available on request</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            {NAV_LINKS.map(l => (
              <button
                key={l.href}
                onClick={() => document.querySelector(l.href)?.scrollIntoView({ behavior: 'smooth' })}
                className="hover:text-sky-400 transition-colors cursor-pointer"
              >
                {l.label}
              </button>
            ))}
            <a href="/blog" className="hover:text-sky-400 transition-colors cursor-pointer">Guides</a>
            <a href="/services/commercial-window-cleaning-canberra" className="hover:text-sky-400 transition-colors cursor-pointer">Commercial</a>
            <a href="/services/pressure-washing-canberra" className="hover:text-sky-400 transition-colors cursor-pointer">Pressure Washing</a>
            <a href="/faq" className="hover:text-sky-400 transition-colors cursor-pointer">FAQ</a>
            <a href="/privacy" className="hover:text-sky-400 transition-colors cursor-pointer">Privacy Policy</a>
          </div>
          <div className="flex gap-3">
            <a
              href="https://www.facebook.com/profile.php?id=61573538586021"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Glass & Blast on Facebook"
              className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center text-slate-400 hover:text-sky-400 hover:border-sky-400/30 transition-all cursor-pointer"
            >
              <Facebook className="w-4 h-4" />
            </a>
            <a
              href="https://www.google.com/maps/place/Glass+%26+Blast+Canberra/@-35.2642025,149.1327069,13z/data=!4m16!1m9!3m8!1s0x86988222311ebd0b:0xdc5b58d488c06a36!2sGlass+%26+Blast+Canberra!8m2!3d-35.2641588!4d149.1323995!9m1!1b1!16s%2Fg%2F11x1pjbn9b!3m5!1s0x86988222311ebd0b:0xdc5b58d488c06a36!8m2!3d-35.2641588!4d149.1323995!16s%2Fg%2F11x1pjbn9b?hl=en"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Glass & Blast on Google"
              className="w-9 h-9 rounded-xl glass border border-white/10 flex items-center justify-center hover:border-sky-400/30 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </a>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-600 text-xs">
          <span>© {new Date().getFullYear()} Glass & Blast Window Cleaning. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Award className="w-3 h-3 text-amber-400" /> 2025 Best Window Cleaner – North Canberra
            </span>
            <a href="/admin" className="flex items-center gap-1 text-slate-500 hover:text-sky-400 transition-colors cursor-pointer">
              <Lock className="w-3 h-3" /> Sign In
            </a>
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
      <main>
        <Hero />
        <StatsBar />
        <Services />
        <WhyUs />
        <OurWork />
        <Reviews />
        <BookingForm />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
