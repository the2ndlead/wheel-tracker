import { useEffect } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div role="status" className="fixed bottom-4 right-4 z-[60] rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
      {toast.text}
    </div>
  );
}
