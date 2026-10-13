import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONES: Record<Tone, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'ring-green-200', iconColor: 'text-green-600' },
  error: { icon: AlertCircle, ring: 'ring-red-200', iconColor: 'text-red-600' },
  info: { icon: Info, ring: 'ring-ayira-200', iconColor: 'text-ayira-600' },
};

// Errors stay longer: the reader has to act on them, not just notice them.
const LIFETIME: Record<Tone, number> = { success: 3500, error: 7000, info: 4500 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: Tone, message: string) => {
    const id = nextId.current++;
    // Three at a time; beyond that the oldest is pushed out rather than
    // growing a column that covers the page.
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
        // Announced by screen readers without stealing focus.
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { icon: Icon, ring, iconColor } = TONES[toast.tone];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), LIFETIME[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl bg-white p-3.5 shadow-pop ring-1 ${ring}`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconColor}`} aria-hidden />
      <p className="flex-1 text-sm leading-snug text-slate-700">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
