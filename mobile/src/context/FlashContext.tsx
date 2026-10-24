import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type FlashTone = 'success' | 'error' | 'info';

export interface Flash {
  id: number;
  message: string;
  tone: FlashTone;
}

/** Success and info messages disappear on their own; errors stay until dismissed. */
export const FLASH_DURATION_MS = 4000;

interface FlashContextValue {
  flash: Flash | null;
  show: (message: string, tone?: FlashTone) => void;
  dismiss: () => void;
}

const FlashContext = createContext<FlashContextValue | null>(null);

/**
 * One message at a time, shown inline as a banner by the screen that owns it. It lets a screen
 * that is about to close (Add loan) leave a confirmation for the screen it returns to.
 */
export function FlashProvider({ children }: { children: ReactNode }) {
  const [flash, setFlash] = useState<Flash | null>(null);

  const show = useCallback((message: string, tone: FlashTone = 'success') => {
    setFlash((previous) => ({ id: (previous?.id ?? 0) + 1, message, tone }));
  }, []);
  const dismiss = useCallback(() => setFlash(null), []);

  useEffect(() => {
    if (!flash || flash.tone === 'error') return;
    const id = flash.id;
    const timer = setTimeout(() => setFlash((current) => (current?.id === id ? null : current)), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const value = useMemo(() => ({ flash, show, dismiss }), [flash, show, dismiss]);
  return <FlashContext.Provider value={value}>{children}</FlashContext.Provider>;
}

export function useFlash(): FlashContextValue {
  const value = useContext(FlashContext);
  if (!value) throw new Error('useFlash must be used inside <FlashProvider>.');
  return value;
}
