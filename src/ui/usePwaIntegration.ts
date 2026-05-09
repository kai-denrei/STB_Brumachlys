// Service-worker update toast plumbing + Chromium install-prompt capture.
// Scope deliberately narrow — the visible UI lives in UpdateToast / InstallPill.

import { useEffect, useRef, useState } from 'react';
import { Workbox } from 'workbox-window';

// Minimal shape of the BeforeInstallPromptEvent (not in the standard Event lib).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function useServiceWorkerUpdate(): {
  needsUpdate: boolean;
  applyUpdate: () => void;
} {
  const wbRef = useRef<Workbox | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (import.meta.env.DEV) return;
    // Honour Vite's base path so the SW registers correctly on subpath deploys
    // (e.g. GitHub Pages serving at /STB_Brumachlys/).
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    const wb = new Workbox(swUrl);
    wbRef.current = wb;
    wb.addEventListener('waiting', () => setNeedsUpdate(true));
    wb.addEventListener('controlling', () => window.location.reload());
    wb.register().catch((err) => {
      console.warn('[brumachlys] SW registration failed:', err);
    });
  }, []);

  function applyUpdate() {
    wbRef.current?.messageSkipWaiting();
  }
  return { needsUpdate, applyUpdate };
}

export function useInstallPrompt(eligible: boolean): {
  canInstall: boolean;
  install: () => void;
  dismiss: () => void;
  iosHintVisible: boolean;
  dismissIosHint: () => void;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('brumachlys-install-dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [iosDismissed, setIosDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('brumachlys-ios-a2hs-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function handler(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const isStandalone =
    typeof window !== 'undefined' &&
    (matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari exposes navigator.standalone for installed PWAs
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  const isIos =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS/.test(navigator.userAgent);

  function install() {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(() => {
      setDeferred(null);
      try {
        localStorage.setItem('brumachlys-install-dismissed', '1');
      } catch {}
    });
  }
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem('brumachlys-install-dismissed', '1');
    } catch {}
  }
  function dismissIosHint() {
    setIosDismissed(true);
    try {
      localStorage.setItem('brumachlys-ios-a2hs-dismissed', '1');
    } catch {}
  }

  return {
    canInstall: eligible && !!deferred && !dismissed && !isStandalone,
    install,
    dismiss,
    iosHintVisible: eligible && isIos && !isStandalone && !iosDismissed,
    dismissIosHint,
  };
}
