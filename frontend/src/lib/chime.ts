// Audible door-scan chime for the PALCO gate camera (business scanner). A real
// door scanner has to be usable without looking at the phone: the operator hears
// a bright "di-ding" the instant a guest is admitted, a low buzz when a code is
// refused. On WEB this is a tiny Web Audio synth — no asset, no CDN, works
// offline. On NATIVE it is a no-op: React Native ships no audio engine without a
// native module (expo-audio) that is not in the current build, and the scanner
// already fires expo-haptics on every commit moment, so the operator still gets
// a success/error pulse. If literal sound on iOS/Android is wanted, it rides a
// future build that adds expo-audio — never an OTA (a missing native module
// crashes the older runtime).
//
// Browsers only let audio start from a user gesture, so `primeAudio()` is called
// on the "Escanear con cámara" tap to create + resume the context; the chimes
// that follow (seconds later, outside the gesture) then play.
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';
const g: any = globalThis as any;

let ctx: AudioContext | null = null;

/** The shared AudioContext, created lazily and resumed; null when audio is unavailable. */
function audio(): AudioContext | null {
  if (!isWeb) return null;
  try {
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      try {
        // iOS Safari 17+: route as media playback so the chime survives the ringer switch
        // (a door phone is routinely silenced). Optional API — absent elsewhere.
        const session = (navigator as any).audioSession;
        if (session && typeof session.type === 'string') session.type = 'playback';
      } catch { /* optional API */ }
    }
    // iOS also parks the context as 'interrupted' (a call, Siri), not just 'suspended':
    // resume on anything that is not running; a rejected resume is just "no sound yet".
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** One shaped tone with a soft attack/decay so it never clicks. */
function tone(c: AudioContext, freq: number, startAt: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.03);
}

/**
 * Prime the audio engine from a user gesture (the camera-open tap). Safe to call
 * repeatedly; a no-op on native and when Web Audio is unavailable.
 */
export function primeAudio(): void {
  audio();
}

/**
 * Play the door-scan chime. `ok` → a bright ascending "di-ding" (admitted);
 * otherwise a short low buzz (refused / not admitted). The banner color carries
 * which kind of refusal it is; the sound only says yes or no.
 */
export function playChime(ok: boolean): void {
  const c = audio();
  if (!c) return;
  try {
    const t = c.currentTime;
    if (ok) {
      tone(c, 988, t, 0.11, 'sine', 0.16); // B5
      tone(c, 1319, t + 0.1, 0.17, 'sine', 0.16); // E6
    } else {
      tone(c, 220, t, 0.14, 'square', 0.1); // A3
      tone(c, 175, t + 0.13, 0.2, 'square', 0.1); // F3 — descending "no"
    }
  } catch {
    /* an audio hiccup must never break scanning */
  }
}
