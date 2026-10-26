/**
 * Minimal, original sound effects synthesized with the Web Audio API (no audio files, nothing to
 * license). Muted by default (PRODUCT_SPEC §5.6); the preference is remembered per browser.
 * The AudioContext is only created after the user turns sound on (a user gesture), so the
 * autoplay policy is never violated.
 */
export type Sfx = 'yourTurn' | 'place' | 'break' | 'repair' | 'reveal' | 'win' | 'lose';

const KEY = 'tunnels.sound';
let context: AudioContext | null = null;

export function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference is a convenience only.
  }
}

/** Call from a click handler when the user enables sound. */
export function unlockAudio(): void {
  const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
  if (!Ctor) return;
  context ??= new Ctor();
  void context.resume().catch(() => undefined);
}

const NOTES: Record<Sfx, readonly [frequency: number, startS: number, durationS: number][]> = {
  yourTurn: [
    [523, 0, 0.12],
    [784, 0.12, 0.18],
  ],
  place: [[196, 0, 0.09]],
  break: [
    [311, 0, 0.08],
    [233, 0.08, 0.14],
  ],
  repair: [
    [392, 0, 0.08],
    [523, 0.08, 0.12],
  ],
  reveal: [
    [659, 0, 0.12],
    [880, 0.12, 0.24],
  ],
  win: [
    [523, 0, 0.14],
    [659, 0.14, 0.14],
    [784, 0.28, 0.3],
  ],
  lose: [
    [392, 0, 0.18],
    [311, 0.18, 0.3],
  ],
};

export function playSfx(name: Sfx): void {
  if (!context || context.state !== 'running') return;
  const now = context.currentTime;
  for (const [frequency, start, duration] of NOTES[name]) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.02);
  }
}
