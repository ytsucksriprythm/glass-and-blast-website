'use client';

// A booking's customer name; tapping it opens that customer's page.
// Recurring customers (recurringId set) show in amber with a repeat icon and
// open their recurring profile; everyone else opens /admin/customers/[bookingId]
// (all their jobs, book a one-off). It's a span rather than a link so it can
// sit inside the clickable booking rows/cards/buttons without nesting
// interactive elements — the click is stopped here so the row doesn't also
// open the booking.
import { useRouter } from 'next/navigation';
import { Repeat } from 'lucide-react';
import { profileHref } from '@/lib/recurring';

export const customerHref = (bookingId: string, from?: string) =>
  `/admin/customers/${bookingId}${from ? `?from=${encodeURIComponent(from)}` : ''}`;

export default function CustomerName({ name, bookingId, recurringId, from, className = '', iconClassName = 'w-3.5 h-3.5' }: {
  name: string;
  bookingId: string;
  recurringId?: string | null;
  from?: string;          // page to come Back to from the profile
  className?: string;     // sizing/weight; colour is decided here for recurring customers
  iconClassName?: string;
}) {
  const router = useRouter();
  const go = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const back = from ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : undefined);
    router.push(recurringId ? profileHref(recurringId, back) : customerHref(bookingId, back));
  };
  const common = {
    role: 'link' as const,
    tabIndex: 0,
    onClick: go,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') go(e); },
  };
  if (!recurringId) {
    return (
      <span {...common} title={`Open ${name}'s customer page`} className={`${className} hover:underline underline-offset-2 cursor-pointer`}>
        {name}
      </span>
    );
  }
  return (
    <span
      {...common}
      title={`Recurring customer: open ${name}'s profile`}
      className={`${className} !text-amber-300 hover:!text-amber-200 hover:underline underline-offset-2 inline-flex items-center gap-1 cursor-pointer min-w-0`}
    >
      <Repeat className={`${iconClassName} flex-shrink-0`} />
      <span className="truncate">{name}</span>
    </span>
  );
}
