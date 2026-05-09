// Two-tap hand-off overlay (DECISIONS.md §B.7).
// Stage 1: full-screen black overlay with "tap when ready" copy.
// Stage 2: confirm button "I am Player 2 — Reveal".

import { useStore } from '../state/store.ts';

export function Handoff() {
  const stage = useStore((s) => s.handoffStage);
  const start = useStore((s) => s.startHandoffConfirm);
  const resolve = useStore((s) => s.resolveHandoff);

  if (stage === 'none') return null;

  if (stage === 'awaiting-tap') {
    return (
      <div className="handoff-overlay" onClick={start}>
        <div className="handoff-inner">
          <span className="handoff-mark">✦</span>
          <h2>Pass device to Player 2</h2>
          <p className="handoff-cue">tap when ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className="handoff-overlay">
      <div className="handoff-inner">
        <span className="handoff-mark">✦</span>
        <p className="handoff-prompt">PLAYER 2 ONLY</p>
        <button className="handoff-reveal" onClick={resolve}>
          I am Player 2 — Reveal
        </button>
      </div>
    </div>
  );
}
