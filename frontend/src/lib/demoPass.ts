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

// Official-services lane (the government pitch): the tourist pays a public
// levy or municipal pass INSIDE the app, the ENTITY collects directly, AMO is
// only the technology channel issuing the QR credential — the same model copy
// /gobierno ships. Amounts are demo data (labeled); folios are minted locally.
export type DemoOfficial = {
  id: string;
  name: string;        // tr() key
  entity: string;      // tr() key — who collects
  priceCop: number;    // COP, demo amount
  icon: string;
};

export const DEMO_OFFICIAL: DemoOfficial[] = [
  { id: 'tasa_portuaria', name: 'Tasa portuaria — salida a islas', entity: 'Entidad portuaria distrital', priceCop: 25000, icon: 'boat-outline' },
  { id: 'aqua_taxi', name: 'Pase aqua-taxi — bahía (día)', entity: 'Autoridad de transporte acuático', priceCop: 18000, icon: 'water-outline' },
  { id: 'castillo', name: 'Entrada — patrimonio histórico', entity: 'Entidad de patrimonio', priceCop: 35000, icon: 'business-outline' },
];

export const fmtCop = (n: number): string => `$${n.toLocaleString('es-CO')} COP`;

export const WELCOME_PTS = 100;  // +100 pts de bienvenida al activar
export const REDEEM_PTS = 50;    // +50 pts por canje
export const GOAL_PTS = 500;     // 500 pts = $5 de crédito AMO

export type DemoStep =
  | 'intro' | 'checkout' | 'active' | 'perks' | 'redeem' | 'rewards'
  | 'oficial' | 'business' | 'gobierno';

export type DemoState = {
  step: DemoStep;
  tier: DemoTier | null;
  method: DemoMethod | null;
  paying: boolean;
  redeemed: string[];        // perk ids, in redemption order (drives history)
  redeemingId: string | null; // perk currently on the QR screen
  officialPaid: string[];    // official-service ids paid (demo folios derive from order)
};

export const initialDemoState = (): DemoState => ({
  step: 'intro',
  tier: null,
  method: null,
  paying: false,
  redeemed: [],
  redeemingId: null,
  officialPaid: [],
});

export const demoPoints = (s: DemoState): number =>
  (s.tier ? WELCOME_PTS : 0) + s.redeemed.length * REDEEM_PTS;
