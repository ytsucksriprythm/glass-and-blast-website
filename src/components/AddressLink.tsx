// Turns an address string into a Google Maps link. Used everywhere an address
// is shown so a rep/owner can tap straight through to directions.
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function AddressLink({ address, className = '', stop = false }: {
  address: string;
  className?: string;
  stop?: boolean; // stop click bubbling when the address sits inside a clickable row
}) {
  const a = (address || '').trim();
  if (!a) return null;
  return (
    <a
      href={mapsUrl(a)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop ? (e) => e.stopPropagation() : undefined}
      className={`hover:text-sky-400 hover:underline cursor-pointer ${className}`}
    >
      {a}
    </a>
  );
}
