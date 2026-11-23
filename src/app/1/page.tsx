import Homepage from '@/components/Homepage';

export const metadata = { robots: { index: false, follow: true } };

export default function Page() {
  return <Homepage variant="original" />;
}
