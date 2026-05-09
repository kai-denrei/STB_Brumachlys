// Bottom-of-screen toast strip for PWA affordances:
//  • SW update available
//  • Install prompt (Chromium)
//  • iOS Add-to-Home-Screen hint

import { useServiceWorkerUpdate, useInstallPrompt } from './usePwaIntegration.ts';

type Props = {
  installEligible: boolean; // gate install offer on game progression (post round 1)
};

export function PwaToasts({ installEligible }: Props) {
  const { needsUpdate, applyUpdate } = useServiceWorkerUpdate();
  const { canInstall, install, dismiss, iosHintVisible, dismissIosHint } =
    useInstallPrompt(installEligible);

  if (!needsUpdate && !canInstall && !iosHintVisible) return null;

  return (
    <div className="pwa-toast-stack">
      {needsUpdate && (
        <div className="pwa-toast">
          <span className="pwa-toast-text">New version ready</span>
          <button className="pwa-toast-action" onClick={applyUpdate}>
            Update
          </button>
        </div>
      )}
      {canInstall && (
        <div className="pwa-toast">
          <span className="pwa-toast-text">Install Brumachlys</span>
          <button className="pwa-toast-action" onClick={install}>
            Install
          </button>
          <button className="pwa-toast-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ✕
          </button>
        </div>
      )}
      {iosHintVisible && (
        <div className="pwa-toast pwa-toast-hint">
          <span className="pwa-toast-text">
            Tap <span className="pwa-share-glyph">⎙</span> then “Add to Home Screen”
          </span>
          <button className="pwa-toast-dismiss" aria-label="Dismiss" onClick={dismissIosHint}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
