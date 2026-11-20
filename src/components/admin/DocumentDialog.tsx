'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function DocumentDialog({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose(); }}
      className={'fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-2xl border border-white/10 bg-navy-800 p-0 text-slate-100 backdrop:bg-black/60 sm:inset-0 sm:m-auto sm:rounded-2xl ' + (wide ? 'sm:max-w-6xl' : 'sm:max-w-lg')}>
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
          <h2 id={heading} className="font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-lg hover:bg-white/10"><X className="size-5" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>{children}</div>
      </div>
    </dialog>
  );
}
