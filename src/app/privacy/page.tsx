import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy | Glass & Blast Window Cleaning',
  description: 'How Glass & Blast Window Cleaning collects, uses and protects your personal information, in accordance with the Australian Privacy Act 1988 (Cth).',
};

const UPDATED = '1 June 2026';
const SITE = process.env.NEXT_PUBLIC_URL || 'https://glassandblast.com.au';
const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Privacy Policy', item: `${SITE}/privacy` },
  ],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3 text-slate-600 leading-relaxed text-sm">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {/* Top bar */}
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Image src="/logo.png" alt="Glass & Blast Window Cleaning" width={150} height={60} className="object-contain h-12 w-auto" />
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-sky-600 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to site
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-16 space-y-10">
        <div className="space-y-3">
          <h1 className="font-display text-4xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="text-slate-500 text-sm">Last updated: {UPDATED}</p>
        </div>

        <div className="space-y-3 text-slate-600 leading-relaxed text-sm">
          <p>
            Glass &amp; Blast Window Cleaning (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is committed to protecting your privacy.
            This policy explains how we collect, use, disclose and safeguard your personal information,
            in accordance with the <strong className="text-slate-900">Privacy Act 1988 (Cth)</strong> and the
            <strong className="text-slate-900"> Australian Privacy Principles (APPs)</strong>.
          </p>
          <p>
            By using our website or booking our services, you consent to the collection and use of your
            information as described in this policy.
          </p>
        </div>

        <Section title="1. Information We Collect">
          <p>We collect personal information that you provide directly when you request a quote or make a booking, including:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your name</li>
            <li>Contact details (phone number and email address)</li>
            <li>Service address and suburb</li>
            <li>Details of the service you request and any notes you provide</li>
          </ul>
          <p>We do not collect sensitive information (as defined in the Privacy Act) and we do not knowingly collect information from children.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>We use your personal information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Respond to your enquiry and provide a quote</li>
            <li>Schedule, perform and follow up on the services you book</li>
            <li>Contact you about your booking by phone, SMS or email</li>
            <li>Maintain our business records and improve our services</li>
          </ul>
          <p>We will only use your information for the purpose for which it was collected, or a related purpose you would reasonably expect.</p>
        </Section>

        <Section title="3. Disclosure of Your Information">
          <p>
            We do not sell, rent or trade your personal information. We will not disclose it to third parties
            except where necessary to provide our services, where you have consented, or where required or
            authorised by law.
          </p>
          <p>
            Your booking details may be transmitted to the business owners via email and SMS using trusted
            third-party providers (such as email and messaging services) solely for the purpose of fulfilling
            your booking.
          </p>
        </Section>

        <Section title="4. Storage and Security">
          <p>
            We take reasonable steps to protect your personal information from misuse, loss, unauthorised
            access, modification or disclosure. Booking information is stored securely and access is limited
            to the business owners.
          </p>
          <p>
            We retain your information only for as long as necessary to fulfil the purposes described in this
            policy or as required by law, after which it is securely deleted or de-identified.
          </p>
        </Section>

        <Section title="5. Access and Correction">
          <p>
            Under the Australian Privacy Principles, you have the right to request access to the personal
            information we hold about you, and to ask us to correct it if it is inaccurate, out of date or
            incomplete. To make a request, please contact us using the details below. We will respond within
            a reasonable period.
          </p>
        </Section>

        <Section title="6. Cookies and Website Analytics">
          <p>
            Our website may use cookies and similar technologies to help it function and to understand how
            visitors use the site. You can disable cookies through your browser settings, though some
            features of the site may not work as intended.
          </p>
        </Section>

        <Section title="7. Complaints">
          <p>
            If you believe we have breached the Australian Privacy Principles or mishandled your personal
            information, please contact us first so we can address your concern. If you are not satisfied with
            our response, you may lodge a complaint with the Office of the Australian Information Commissioner
            (OAIC) at <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">www.oaic.gov.au</a>.
          </p>
        </Section>

        <Section title="8. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Any changes will be published on this page
            with an updated &ldquo;Last updated&rdquo; date.
          </p>
        </Section>

        <Section title="9. Contact Us">
          <p>For any questions about this policy or your personal information, contact us:</p>
          <ul className="list-none space-y-1">
            <li><span className="text-slate-900">Glass &amp; Blast Window Cleaning</span></li>
            <li>North Canberra, ACT</li>
            <li>Phone: <a href="tel:+61466050834" className="text-sky-600 hover:underline">0466 050 834</a></li>
          </ul>
        </Section>

        <div className="pt-6 border-t border-slate-200">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-sky-600 hover:text-sky-700 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to Glass &amp; Blast
          </Link>
        </div>
      </article>
    </main>
  );
}
