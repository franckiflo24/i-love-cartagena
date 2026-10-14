// DROP D1 — DEMO-ONLY data + state for /pase-demo (the money-loop walkthrough).
//
// HONESTY CONTRACT: everything in this module is a labeled simulation. It has
// ZERO imports — no api, no fetch, no AsyncStorage/SecureStore — so finishing
// the demo cannot write a reservation, ticket, points row or anything else.
// State lives in React memory on the route and dies on navigation. The perk
// seals shown in the demo are part of the simulation ("DEMO · Simulación" is
// persistent on every screen); the REAL verificado ledger is untouched and
// still has exactly one writer (verify-provider).

export type DemoTierId = 'dia' | 'semana' | 'viaje';

export type DemoTier = {
  id: DemoTierId;
  name: string;        // tr() key
  price: number;       // USD, per the approved demo
  days: string;        // tr() key — duration line
  popular?: boolean;
};

export const DEMO_TIERS: DemoTier[] = [
  { id: 'dia', name: 'Pase Día', price: 15, days: '1 día de beneficios' },
  { id: 'semana', name: 'Pase Semana', price: 45, days: '7 días de beneficios', popular: true },
  { id: 'viaje', name: 'Pase Viaje', price: 75, days: 'Todo tu viaje (hasta 30 días)' },
];

export type DemoPerk = {
  id: string;
  partner: string;     // display name (proper noun — never translated)
  perk: string;        // tr() key
  icon: string;        // Ionicons name
};

// The approved demo roster. Partner names are display-only props of the
// simulation; no partner_id is referenced so nothing links into real records.
export const DEMO_PERKS: DemoPerk[] = [
  { id: 'carmen', partner: 'Carmen', perk: 'Cóctel de bienvenida', icon: 'wine-outline' },
  { id: 'nueva_lengua', partner: 'Nueva Lengua', perk: '15% en el curso semanal de español', icon: 'school-outline' },
  { id: 'epoca', partner: 'Época Café', perk: '2x1 en bebida de especialidad', icon: 'cafe-outline' },
  { id: 'makani', partner: 'Makani', perk: 'Sunbed + bebida incluida', icon: 'sunny-outline' },
  { id: 'bastion', partner: 'Bastión', perk: '20% en spa', icon: 'flower-outline' },
];

export const DEMO_METHODS = ['Nequi', 'PSE', 'Tarjeta', 'Bancolombia'] as const;
export type DemoMethod = (typeof DEMO_METHODS)[number];

// D2 — "Pagos oficiales" track: AMO proposed as the digital collection rail
// for the mandatory island-day fees. EVERYTHING here is a labeled PROPOSAL
// with example figures ("tarifas de ejemplo — las define el convenio"): the
// entity names are the real collectors of those fees in the world, but
// nothing may imply they adopted this channel — no seals, no logos, neutral
// text labels only. Client-only data; zero write paths, same as all of D1.
export type SplitLine = {
  id: string;
  name: string;        // tr() key — what the fee is
  entity: string;      // tr() key — who collects it (neutral text label)
  amountCop: number;   // example figure
  color: string;       // split-bar segment
  icon: string;
  clears: string;      // tr() key — what the single QR clears at this stop
};

// Island Day bundle: dock levy + national-park entry + mandatory insurance +
// regulated boat, plus AMO's own service fee (the ONLY line AMO keeps —
// deliberately the smallest and rendered in muted gray, never a brand color).
export const ISLAND_SPLIT: SplitLine[] = [
  { id: 'embarque', name: 'Tasa de embarque — Muelle de la Bodeguita', entity: 'Autoridad marítima (DIMAR)', amountCop: 21000, color: '#12B5A5', icon: 'boat-outline', clears: 'Muelle' },
  { id: 'parque', name: 'Ingreso PNN Corales del Rosario', entity: 'Parques Nacionales', amountCop: 28000, color: '#22C55E', icon: 'leaf-outline', clears: 'Parque' },
  { id: 'seguro', name: 'Seguro obligatorio (Barú/Islas)', entity: 'Aseguradora autorizada', amountCop: 6000, color: '#E9B949', icon: 'medkit-outline', clears: 'Seguro' },
  { id: 'lancha', name: 'Lancha regulada (ida y vuelta)', entity: 'Operador de transporte', amountCop: 55000, color: '#A855F7', icon: 'water-outline', clears: 'Lancha' },
  { id: 'amo', name: 'Tarifa de servicio AMO', entity: 'AMO (canal tecnológico)', amountCop: 5000, color: '#8A93A6', icon: 'phone-portrait-outline', clears: '' },
];

export const islandTotal = (): number => ISLAND_SPLIT.reduce((n, l) => n + l.amountCop, 0);

export const fmtCop = (n: number): string => `$${n.toLocaleString('es-CO')} COP`;

export const WELCOME_PTS = 100;  // +100 pts de bienvenida al activar
export const REDEEM_PTS = 50;    // +50 pts por canje
export const GOAL_PTS = 500;     // 500 pts = $5 de crédito AMO

export type DemoStep =
  | 'intro' | 'checkout' | 'active' | 'perks' | 'redeem' | 'rewards'
  | 'oficial' | 'split' | 'credencial' | 'business' | 'ciudad';

export type DemoState = {
  step: DemoStep;
  tier: DemoTier | null;
  method: DemoMethod | null;
  paying: boolean;
  redeemed: string[];        // perk ids, in redemption order (drives history)
  redeemingId: string | null; // perk currently on the QR screen
  islandPaid: boolean;       // the Island Day bundle went through (demo)
};

export const initialDemoState = (): DemoState => ({
  step: 'intro',
  tier: null,
  method: null,
  paying: false,
  redeemed: [],
  redeemingId: null,
  islandPaid: false,
});

export const demoPoints = (s: DemoState): number =>
  (s.tier ? WELCOME_PTS : 0) + s.redeemed.length * REDEEM_PTS;
