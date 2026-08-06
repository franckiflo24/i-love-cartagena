// Drop GATE (Part C) — instrumentation. Fire-and-forget funnel events so the
// gate's effect is measurable: gate_shown → gate_cta → signup → activation,
// split by archetype (invited vs cold) and by which action triggered the wall.
// Fails silently; never blocks a user interaction.
import { API_BASE } from '../constants/api';

type GateEvent = 'gate_shown' | 'gate_cta' | 'gate_dismissed' | 'luna_taste' | 'activation';

// A stable-per-session anonymous id so the funnel can be stitched without auth.
function sessionId(): string {
  try {
    let s = sessionStorage.getItem('amo_sess');
    if (!s) { s = 'g' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem('amo_sess', s); }
    return s;
  } catch { return 'anon'; }
}

export function trackGate(event: GateEvent, data: { action?: string; archetype?: string } = {}) {
  try {
    fetch(`${API_BASE}/analytics/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event, action: data.action || 'generic', archetype: data.archetype || 'cold',
        session: sessionId(),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// Set once when a visitor arrives via an invite/share link, so every later gate
// and the eventual signup are attributed to the 'invited' archetype.
export function markArchetype(a: 'invited' | 'cold') {
  try { sessionStorage.setItem('amo_archetype', a); } catch {}
}

export function getArchetype(): 'invited' | 'cold' {
  try { return (sessionStorage.getItem('amo_archetype') as any) || 'cold'; } catch { return 'cold'; }
}
