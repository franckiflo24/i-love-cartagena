// Atlas layer — source-verified venue positions from the AMO Cartagena Atlas.
//
// Every entry below was adversarially verified against OSM authority data
// (building footprints, street geometry, house-number interpolation, neighbor
// consistency) on 2026-09-05. Full per-place verdicts with reasoning live in
// docs/atlas-verification.json at the repo root.
//
// The map applies this layer INSIDE buildPlaces — i.e. after EVERY data merge,
// static and backend hydrate alike — so a stale Mongo venue coordinate can
// never regress a verified pin (the backend /venues collection still carries
// the pre-fix coords for ven_003 / ven_006 and has no coord-update endpoint).

export type AtlasVenueFix = { lat: number; lng: number; address?: string };

// Pin ids (partner_id / attraction id / venue_id) whose live coordinate is
// atlas-verified. The map renders these with a precision halo and a
// "Ubicación verificada" badge in the popup.
export const ATLAS_VERIFIED: ReadonlySet<string> = new Set([
  'ptr_1403',   // Casa Carolina Hotel — coords bit-identical atlas↔partner
  'ptr_V014',   // Casa Bohême (house) — 3.8m atlas↔partner
  'ptr_CB_003', // El Jardín — Casa Bohème (same building)
  'ptr_CB_005', // Ban Thai — Casa Bohème (same building)
  'ptr_R051',   // Juliette & Yoyo — Casa Bohème (same building)
  'ptr_V024',   // El Pasquín de Joaco — OSM node exact-match, 13m offset
  'ptr_R022',   // Buena Vida Marisquería — OSM node (cuisine=seafood), 7.7m
  'ptr_1303',   // El beso Bar-Restaurant — partner coord PROVEN vs misplaced OSM node
  'attr_009',   // Catedral de Santa Catalina — OSM way 49666923 exact name match
  'attr_003',   // Torre del Reloj — OSM way 955128419 centroid 6m
  'attr_008',   // Iglesia San Pedro Claver — OSM way 955128421 centroid
  'ven_003',    // Casa Bohème (editorial venue) — corrected below
  'ven_006',    // San Pedro Claver (editorial venue) — corrected below
  'ven_011',    // Centro de Convenciones — added below
]);

// Editorial venue records whose stored coords were provably wrong (~160-170m
// off the verified building). Overridden at merge time — this also fixes
// concert pins, which inherit their venue's coordinate.
export const ATLAS_VENUE_FIXES: Readonly<Record<string, AtlasVenueFix>> = {
  // Casa Bohème — was 10.4228,-75.551 (~160m off); address also corrected, and
  // must ride the override too or the backend hydrate reverts it in popups.
  ven_003: {
    lat: 10.4241036,
    lng: -75.5518067,
    address: 'Cl. 35 #3-30, Plaza Santo Domingo, Centro Histórico',
  },
  ven_006: { lat: 10.4217511, lng: -75.5510213 }, // San Pedro Claver — was 10.4228,-75.5498 (~170m off)
};

// Camera route exported from the AMO Cartagena Atlas (docs/amo-cartagena-route.json).
// Drives the map's cinematic fly-through (auto-satellite). Two edits vs the raw
// export: the "El Beso" stop is corrected to the VERIFIED venue coordinate (the
// export still carried the misplaced OSM node — docs/atlas-verification.json),
// and the closing overview moved to the end so the tour lands wide.
export type AtlasViewpoint = { title: string; lat: number; lng: number; zoom: number };

// Virtual stroll for users OUTSIDE Cartagena (the real walking layer is
// distance-gated and honest — it never activates remotely). Every waypoint is
// an atlas-verified venue coordinate, ordered as a walkable Centro→Getsemaní
// loop. Display-only: passport stamps stay behind the server's 75m real-GPS gate.
export const ATLAS_WALK: AtlasViewpoint[] = [
  { title: 'Torre del Reloj', lat: 10.423036, lng: -75.549219, zoom: 18 },
  { title: 'El Pasquín de Joaco', lat: 10.4234706, lng: -75.5495415, zoom: 18 },
  { title: 'Casa Carolina', lat: 10.4236246, lng: -75.5502602, zoom: 18 },
  { title: 'Catedral de Santa Catalina', lat: 10.4236446, lng: -75.5506735, zoom: 18 },
  { title: 'Plaza Santo Domingo — Casa Bohème', lat: 10.4241036, lng: -75.5518067, zoom: 18 },
  { title: 'San Pedro Claver', lat: 10.4217511, lng: -75.5510213, zoom: 18 },
  { title: 'Centro de Convenciones', lat: 10.420559, lng: -75.549046, zoom: 18 },
  { title: 'El Beso — Getsemaní', lat: 10.4195719, lng: -75.5464839, zoom: 18 },
];

export const ATLAS_ROUTE: AtlasViewpoint[] = [
  { title: 'Cartagena desde arriba', lat: 10.4234, lng: -75.5489, zoom: 14.8 },
  { title: 'Torre del Reloj', lat: 10.423036, lng: -75.549219, zoom: 18.2 },
  { title: 'Casa Carolina', lat: 10.4236246, lng: -75.5502602, zoom: 18.7 },
  { title: 'Casa Bohème', lat: 10.4240694, lng: -75.5518061, zoom: 18.7 },
  { title: 'El Beso, Getsemaní', lat: 10.4195719, lng: -75.5464839, zoom: 18.5 }, // verified coord, not the export's
  { title: 'El Pasquín de Joaco', lat: 10.4235694, lng: -75.5494741, zoom: 19 },
  { title: 'Amo Cartagena ❤️', lat: 10.4234, lng: -75.5489, zoom: 14.8 },
];

// Curated walking rutas for the CAMINAR feature — authored sequences over
// atlas-verified coordinates (order is editorial, never reshuffled). meters /
// minutes are PRECOMPUTED against the committed walkgraph (scratch:
// compute-rutas.mjs pattern — route() over each stop list) so the sheet can
// show honest numbers before the 400KB graph ever loads. Recompute them if
// walkgraph.json or the stop lists change.
export type AtlasRutaStop = { name: string; lat: number; lng: number };
export type AtlasRuta = {
  id: string;
  title: string;
  subtitle: string; // Spanish base string — UI wraps in tr()
  meters: number;
  minutes: number;
  stops: AtlasRutaStop[];
};

export const ATLAS_RUTAS: AtlasRuta[] = [
  {
    id: 'ruta_centro',
    title: 'Esencia del Centro',
    subtitle: 'Torre del Reloj a Plaza Santo Domingo — el corazón amurallado',
    meters: 573,
    minutes: 7,
    stops: [
      { name: 'Torre del Reloj', lat: 10.423036, lng: -75.549219 },
      { name: 'El Pasquín de Joaco', lat: 10.4234706, lng: -75.5495415 },
      { name: 'Casa Carolina', lat: 10.4236246, lng: -75.5502602 },
      { name: 'Catedral de Santa Catalina', lat: 10.4236446, lng: -75.5506735 },
      { name: 'Plaza Santo Domingo — Casa Bohème', lat: 10.4241036, lng: -75.5518067 },
    ],
  },
  {
    id: 'ruta_getsemani',
    title: 'Del Centro a Getsemaní',
    subtitle: 'De Plaza Santo Domingo al barrio del arte, por la bahía',
    meters: 1423,
    minutes: 19,
    stops: [
      { name: 'Plaza Santo Domingo — Casa Bohème', lat: 10.4241036, lng: -75.5518067 },
      { name: 'San Pedro Claver', lat: 10.4217511, lng: -75.5510213 },
      { name: 'Centro de Convenciones', lat: 10.420559, lng: -75.549046 },
      { name: 'El Beso — Getsemaní', lat: 10.4195719, lng: -75.5464839 },
    ],
  },
  {
    id: 'ruta_completa',
    title: 'Paseo Completo',
    subtitle: 'La vuelta entera: Centro Histórico y Getsemaní en una caminata',
    meters: 1996,
    minutes: 26,
    stops: [
      { name: 'Torre del Reloj', lat: 10.423036, lng: -75.549219 },
      { name: 'El Pasquín de Joaco', lat: 10.4234706, lng: -75.5495415 },
      { name: 'Casa Carolina', lat: 10.4236246, lng: -75.5502602 },
      { name: 'Catedral de Santa Catalina', lat: 10.4236446, lng: -75.5506735 },
      { name: 'Plaza Santo Domingo — Casa Bohème', lat: 10.4241036, lng: -75.5518067 },
      { name: 'San Pedro Claver', lat: 10.4217511, lng: -75.5510213 },
      { name: 'Centro de Convenciones', lat: 10.420559, lng: -75.549046 },
      { name: 'El Beso — Getsemaní', lat: 10.4195719, lng: -75.5464839 },
    ],
  },
];

// Atlas places missing from the catalog entirely. Appended at merge time when
// absent from the incoming venues array (guards against a future backend add).
// Coordinate verified INSIDE the OSM building footprint (way 93829748, 7.9m
// from polygon centroid).
export const ATLAS_ADD_VENUES = [
  {
    venue_id: 'ven_011',
    name: 'Centro de Convenciones',
    type: 'cultural',
    description: 'Centro de Convenciones Cartagena de Indias Julio César Turbay Ayala — el corazón de los grandes eventos de la ciudad, sobre la bahía y al borde de Getsemaní.',
    address: 'Calle del Arsenal, Getsemaní, Cartagena',
    location: { lat: 10.420559, lng: -75.549046 },
    images: [],
    price_range: '',
    booking_link: '',
    hours: '',
    contact: '',
  },
];
