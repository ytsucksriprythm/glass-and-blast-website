export default function CreatedBy({ name }: { name?: string | null }) {
  if (!name) return null;
  return <p className="mt-1 text-xs text-slate-400">Created by {name}</p>;
}
