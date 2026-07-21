import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const STATIC_MODE = process.env.EXPO_PUBLIC_STATIC_MODE === '1' || !BACKEND_URL;
// Optional: a Vercel Edge Function (or any server) that proxies queries to
// Anthropic Claude. When set, /search calls fetch this first and merges the
// AI payload into the static result. Configure via env: EXPO_PUBLIC_AI_PROXY_URL
const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL || (BACKEND_URL ? `${BACKEND_URL}/api/search` : '/api/ai-search');

// ── STATIC FALLBACK ──────────────────────────────────────────────
// When STATIC_MODE is on (or no backend URL configured), GET requests
// resolve from /data/<path>.json files bundled with the web build.
// POST/PUT/PATCH/DELETE become silent no-ops returning {} so the UI
// stays interactive without backend connectivity.
const staticUrl = (path: string): string => {
  // Strip leading slash, strip query string
  const clean = path.replace(/^\/+/, '').split('?')[0];
  return `/data/${clean}.json`;
};

const tryStatic = async (path: string): Promise<any> => {
  try {
    const res = await fetch(staticUrl(path));
    if (!res.ok) return null;
    return await res.json();
  } catch { /* static file not available — expected for missing endpoints */ }
  return null;
};

// ── CLIENT-SIDE SEARCH (static mode) ────────────────────────────
// /search?q=... is dynamic — there's no JSON file for it. In static mode we
// load the catalogs once, lower-case index them, and filter by token match.
type SearchCache = {
  partners: any[]; events: any[]; concerts: any[];
  partner_events: any[]; transport: any[]; venues: any[];
} | null;
let SEARCH_CACHE: SearchCache = null;
let SEARCH_CACHE_PROMISE: Promise<SearchCache> | null = null;

// ── Knowledge base for curated recommendations ──────────────────
type KnowledgeEntry = { category: string; question: string; ranked: string[] };
let KNOWLEDGE_CACHE: KnowledgeEntry[] | null = null;
let KNOWLEDGE_CACHE_PROMISE: Promise<KnowledgeEntry[]> | null = null;

const loadKnowledge = async (): Promise<KnowledgeEntry[]> => {
  if (KNOWLEDGE_CACHE) return KNOWLEDGE_CACHE;
  if (KNOWLEDGE_CACHE_PROMISE) return KNOWLEDGE_CACHE_PROMISE;
  KNOWLEDGE_CACHE_PROMISE = (async () => {
    const data = await tryStatic('/knowledge');
    KNOWLEDGE_CACHE = Array.isArray(data) ? data : [];
    return KNOWLEDGE_CACHE;
  })();
  return KNOWLEDGE_CACHE_PROMISE;
};

/** Match user query against curated knowledge entries.
 *  Returns set of venue names that appear in top matching entries. */
const matchKnowledgeBoosted = async (q: string): Promise<Set<string>> => {
  const entries = await loadKnowledge();
  if (!entries.length) return new Set();
  const qNorm = norm(q);
  const qWords = qNorm.split(/\s+/).filter(w => w.length >= 2);
  if (!qWords.length) return new Set();

  // Score each entry by keyword overlap
  const scored: { entry: KnowledgeEntry; score: number }[] = [];
  for (const entry of entries) {
    const entryText = norm(entry.question) + ' ' + norm(entry.category);
    let score = 0;
    for (const w of qWords) {
      if (entryText.includes(w)) score++;
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Collect venue names from top 3 matching entries
  const boosted = new Set<string>();
  for (const { entry } of scored.slice(0, 3)) {
    for (const name of entry.ranked) {
      boosted.add(norm(name));
    }
  }
  return boosted;
};

const loadSearchCache = async (): Promise<SearchCache> => {
  if (SEARCH_CACHE) return SEARCH_CACHE;
  if (SEARCH_CACHE_PROMISE) return SEARCH_CACHE_PROMISE;
  SEARCH_CACHE_PROMISE = (async () => {
    const [partners, events, concerts, partner_events, transport, venues] = await Promise.all([
      tryStatic('/partners'), tryStatic('/events'), tryStatic('/concerts'),
      tryStatic('/partner-events'), tryStatic('/transport'), tryStatic('/venues'),
    ]);
    SEARCH_CACHE = {
      partners:       Array.isArray(partners) ? partners : [],
      events:         Array.isArray(events) ? events : [],
      concerts:       Array.isArray(concerts) ? concerts : [],
      partner_events: Array.isArray(partner_events) ? partner_events : [],
      transport:      Array.isArray(transport) ? transport : [],
      venues:         Array.isArray(venues) ? venues : [],
    };
    return SEARCH_CACHE;
  })();
  return SEARCH_CACHE_PROMISE;
};

const norm = (s: any): string => (typeof s === 'string' ? s : '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// EN ↔ ES synonym expansion: maps English tourism terms to the Spanish words
// our catalogs actually use. When a user types "walled city" we also search
// for "ciudad amurallada", "centro historico", "casco antiguo".
const SYNONYMS: Record<string, string[]> = {
  // ── Locations ──
  'walled city':       ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'old city':          ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'old town':          ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'historic center':   ['centro historico', 'ciudad amurallada'],
  'historic centre':   ['centro historico', 'ciudad amurallada'],
  'downtown':          ['centro', 'centro historico'],
  'getsemani':         ['getsemani'],

  // ── Restaurants / dining (existing) ──
  'restaurants':       ['restaurante', 'comida', 'gastronomia'],
  'restaurant':        ['restaurante', 'comida', 'gastronomia'],
  'dining':            ['restaurante', 'comida', 'gastronomia'],
  'fine dining':       ['restaurante', 'gastronomia'],
  'food':              ['comida', 'restaurante', 'gastronomia'],

  // ── Food concepts (NEW) ──
  'fish':              ['mariscos', 'seafood', 'pescado', 'ceviche'],
  'pescado':           ['mariscos', 'seafood', 'pescado', 'ceviche'],
  'poisson':           ['mariscos', 'seafood', 'pescado', 'ceviche'],
  'peixe':             ['mariscos', 'seafood', 'pescado', 'ceviche'],
  'seafood':           ['mariscos', 'pescado', 'ceviche', 'langosta', 'camarones'],
  'chicken':           ['restaurante', 'comida', 'local'],
  'pollo':             ['restaurante', 'comida', 'local'],
  'steak':             ['carnes', 'parrilla', 'restaurante'],
  'carne':             ['carnes', 'parrilla', 'restaurante'],
  'meat':              ['carnes', 'parrilla', 'restaurante'],
  'viande':            ['carnes', 'parrilla', 'restaurante'],
  'pizza':             ['italiana', 'pizza', 'restaurante'],
  'pasta':             ['italiana', 'pasta', 'restaurante'],
  'noodles':           ['italiana', 'asiatica', 'restaurante'],
  'ramen':             ['asiatica', 'restaurante'],
  'asian':             ['asiatica', 'restaurante'],
  'tacos':             ['mexicana', 'restaurante'],
  'mexican':           ['mexicana', 'restaurante'],
  'curry':             ['india', 'asiatica', 'restaurante'],
  'indian':            ['india', 'asiatica', 'restaurante'],
  'sushi':             ['asiatica', 'sushi', 'japones'],
  'japanese':          ['asiatica', 'sushi', 'japones'],
  'ceviche':           ['mariscos', 'ceviche', 'peruano'],
  'lobster':           ['mariscos', 'langosta', 'restaurante'],
  'langosta':          ['mariscos', 'langosta', 'restaurante'],
  'shrimp':            ['mariscos', 'camarones'],
  'camarones':         ['mariscos', 'camarones'],
  'brunch':            ['brunch', 'desayuno', 'restaurante'],
  'breakfast':         ['desayuno', 'cafe', 'brunch'],
  'desayuno':          ['desayuno', 'cafe', 'brunch'],
  'lunch':             ['almuerzo', 'restaurante', 'comida'],
  'almuerzo':          ['almuerzo', 'restaurante', 'comida'],
  'dinner':            ['cena', 'restaurante', 'comida'],
  'cena':              ['cena', 'restaurante', 'comida'],
  'ice cream':         ['helados', 'postres'],
  'helado':            ['helados', 'postres'],
  'bakery':            ['panaderia', 'pasteleria'],
  'panaderia':         ['panaderia', 'pasteleria'],
  'cake':              ['pasteleria', 'postres'],
  'pastel':            ['pasteleria', 'postres'],
  'torta':             ['pasteleria', 'postres'],
  'juice':             ['jugos', 'cafe'],
  'jugo':              ['jugos', 'cafe'],
  'smoothie':          ['jugos', 'cafe', 'saludable'],

  // ── Drinks ──
  'coffee':            ['cafe', 'cafeteria'],
  'cafe':              ['cafe', 'cafeteria'],
  'wine':              ['vino', 'bar', 'restaurante'],
  'vino':              ['vino', 'bar', 'restaurante'],
  'beer':              ['cerveceria', 'bar', 'cerveza'],
  'cerveza':           ['cerveceria', 'bar', 'cerveza'],
  'biere':             ['cerveceria', 'bar', 'cerveza'],
  'rum':               ['ron', 'bar'],
  'ron':               ['ron', 'bar'],
  'tequila':           ['bar', 'coctel'],
  'mezcal':            ['bar', 'coctel'],
  'whisky':            ['bar', 'whisky'],
  'whiskey':           ['bar', 'whisky'],
  'cocktail':          ['bar', 'cocteleria', 'coctel'],
  'coctel':            ['bar', 'cocteleria', 'coctel'],
  'drink':             ['bar', 'cocteleria', 'coctel'],
  'drinks':            ['bar', 'cocteleria', 'coctel'],
  'trago':             ['bar', 'cocteleria', 'coctel'],
  'tragos':            ['bar', 'cocteleria', 'coctel'],

  // ── Hunger / Thirst ──
  'hungry':            ['restaurante', 'comida', 'gastronomia'],
  'hambre':            ['restaurante', 'comida', 'gastronomia'],
  'tengo hambre':      ['restaurante', 'comida', 'gastronomia'],
  'thirsty':           ['bar', 'cafe', 'bebida'],
  'sed':               ['bar', 'cafe', 'bebida'],
  'tengo sed':         ['bar', 'cafe', 'bebida'],

  // ── Vibe / Intent ──
  'bored':             ['experiencia', 'actividad', 'tour', 'nightlife'],
  'aburrido':          ['experiencia', 'actividad', 'tour', 'nightlife'],
  'tired':             ['spa', 'bienestar', 'masaje', 'relajar'],
  'cansado':           ['spa', 'bienestar', 'masaje', 'relajar'],
  'need rest':         ['spa', 'bienestar', 'masaje', 'relajar'],
  'relax':             ['spa', 'playa', 'bienestar', 'piscina'],
  'relajar':           ['spa', 'playa', 'bienestar', 'piscina'],
  'chill':             ['spa', 'playa', 'bienestar', 'piscina'],
  'tranquilo':         ['spa', 'playa', 'bienestar', 'piscina'],
  'adventure':         ['actividad', 'tour', 'deporte', 'experiencia'],
  'aventura':          ['actividad', 'tour', 'deporte', 'experiencia'],
  'romantic':          ['romantico', 'pareja', 'cena', 'intimo'],
  'romantico':         ['romantico', 'pareja', 'cena', 'intimo'],
  'date':              ['romantico', 'restaurante', 'bar', 'intimo'],
  'cita':              ['romantico', 'restaurante', 'bar', 'intimo'],
  'date night':        ['romantico', 'restaurante', 'bar', 'intimo'],
  'celebrate':         ['fiesta', 'cumpleanos', 'discoteca', 'club'],
  'celebrar':          ['fiesta', 'cumpleanos', 'discoteca', 'club'],
  'party':             ['fiesta', 'discoteca', 'club', 'nightlife'],
  'birthday':          ['cumpleanos', 'fiesta', 'celebracion'],
  'cumpleanos':        ['cumpleanos', 'fiesta', 'celebracion'],
  'anniversary':       ['aniversario', 'romantico', 'cena'],
  'aniversario':       ['aniversario', 'romantico', 'cena'],
  'wedding':           ['boda', 'evento', 'venue'],
  'boda':              ['boda', 'evento', 'venue'],
  'proposal':          ['propuesta', 'romantico', 'especial'],
  'honeymoon':         ['luna de miel', 'romantico', 'pareja'],
  'luna de miel':      ['luna de miel', 'romantico', 'pareja'],
  'fun':               ['actividad', 'nightlife', 'experiencia'],
  'divertido':         ['actividad', 'nightlife', 'experiencia'],
  'diversion':         ['actividad', 'nightlife', 'experiencia'],
  'vibes':             ['bar', 'nightlife', 'sunset', 'ambiente'],
  'pregame':           ['bar', 'happy hour', 'coctel'],
  'fancy':             ['lujo', 'premium', 'elegante'],
  'elegante':          ['lujo', 'premium', 'elegante'],
  'cheap':             ['popular', 'economico', 'barato'],
  'barato':            ['popular', 'economico', 'barato'],
  'budget':            ['popular', 'economico', 'barato'],
  'economico':         ['popular', 'economico', 'barato'],
  'bougie':            ['lujo', 'premium', 'exclusivo'],
  'luxurious':         ['lujo', 'premium', 'exclusivo'],
  'lujoso':            ['lujo', 'premium', 'exclusivo'],
  'instagrammable':    ['fotografia', 'spots', 'instagram'],
  'instagram':         ['fotografia', 'spots', 'instagram'],
  'photo':             ['fotografia', 'spots', 'instagram'],
  'selfie':            ['fotografia', 'instagram'],
  'view':              ['vista', 'rooftop', 'terraza', 'mirador'],
  'vista':             ['vista', 'rooftop', 'terraza', 'mirador'],
  'pool':              ['piscina', 'hotel', 'beach club', 'day pass'],
  'piscina':           ['piscina', 'hotel', 'beach club', 'day pass'],
  'dance':             ['bailar', 'salsa', 'discoteca', 'club'],
  'bailar':            ['bailar', 'salsa', 'discoteca', 'club'],
  'live music':        ['musica en vivo', 'salsa', 'jazz'],
  'musica en vivo':    ['musica en vivo', 'salsa', 'jazz'],
  'karaoke':           ['karaoke', 'bar', 'noche'],
  'sports':            ['deportivo', 'bar deportivo', 'futbol'],
  'deportes':          ['deportivo', 'bar deportivo', 'futbol'],
  'football':          ['futbol', 'sports bar', 'bar deportivo'],
  'futbol':            ['futbol', 'sports bar', 'bar deportivo'],
  'soccer':            ['futbol', 'sports bar', 'bar deportivo'],

  // ── Weather / Time / Context ──
  'hot':               ['playa', 'piscina', 'helado', 'beach club'],
  'calor':             ['playa', 'piscina', 'helado', 'beach club'],
  'rain':              ['museo', 'shopping', 'spa', 'indoor'],
  'lluvia':            ['museo', 'shopping', 'spa', 'indoor'],
  'rainy':             ['museo', 'shopping', 'spa', 'indoor'],
  'morning':           ['desayuno', 'cafe', 'yoga', 'tour'],
  'manana':            ['desayuno', 'cafe', 'yoga', 'tour'],
  'afternoon':         ['almuerzo', 'playa', 'spa', 'paseo'],
  'tarde':             ['almuerzo', 'playa', 'spa', 'paseo'],
  'tonight':           ['noche', 'bar', 'restaurante', 'discoteca'],
  'esta noche':        ['noche', 'bar', 'restaurante', 'discoteca'],
  'ce soir':           ['noche', 'bar', 'restaurante', 'discoteca'],
  'hoje a noite':      ['noche', 'bar', 'restaurante', 'discoteca'],
  'today':             ['agenda', 'eventos'],
  'hoy':               ['agenda', 'eventos'],
  'tomorrow':          ['planificar', 'tour'],
  'weekend':           ['planes', 'experiencia'],
  'fin de semana':     ['planes', 'experiencia'],
  'free':              ['gratis', 'free', 'sin costo'],
  'gratis':            ['gratis', 'free', 'sin costo'],

  // ── Practical ──
  'money':             ['cajero', 'cambio', 'banco'],
  'dinero':            ['cajero', 'cambio', 'banco'],
  'cash':              ['cajero', 'cambio', 'banco'],
  'efectivo':          ['cajero', 'cambio', 'banco'],
  'atm':               ['cajero', 'banco', 'dinero'],
  'cajero':            ['cajero', 'banco', 'dinero'],
  'sick':              ['hospital', 'clinica', 'farmacia'],
  'enfermo':           ['hospital', 'clinica', 'farmacia'],
  'doctor':            ['clinica', 'hospital', 'medico'],
  'medico':            ['clinica', 'hospital', 'medico'],
  'pharmacy':          ['farmacia'],
  'farmacia':          ['farmacia'],
  'medicine':          ['farmacia'],
  'phone':             ['sim', 'datos', 'telefono'],
  'telefono':          ['sim', 'datos', 'telefono'],
  'celular':           ['sim', 'datos', 'telefono'],
  'wifi':              ['coworking', 'cafe', 'wifi'],
  'internet':          ['coworking', 'cafe', 'wifi'],
  'gym':               ['gimnasio', 'crossfit', 'ejercicio'],
  'gimnasio':          ['gimnasio', 'crossfit', 'ejercicio'],
  'workout':           ['gimnasio', 'crossfit', 'ejercicio'],
  'exercise':          ['gimnasio', 'crossfit', 'ejercicio'],
  'hair':              ['barberia', 'peluqueria', 'salon'],
  'pelo':              ['barberia', 'peluqueria', 'salon'],
  'corte':             ['barberia', 'peluqueria', 'salon'],
  'haircut':           ['peluqueria', 'barberia', 'salon', 'corte'],
  'barber':            ['barberia', 'barbershop', 'peluqueria'],
  'nails':             ['unas', 'manicure', 'pedicure', 'salon'],
  'unas':              ['unas', 'manicure', 'pedicure', 'salon'],
  'tattoo':            ['tatuaje'],
  'tatuaje':           ['tatuaje'],
  'laundry':           ['lavanderia'],
  'lavanderia':        ['lavanderia'],
  'ropa':              ['lavanderia'],
  'taxi':              ['taxi', 'uber', 'transporte'],
  'uber':              ['taxi', 'uber', 'transporte'],
  'ride':              ['taxi', 'uber', 'transporte'],
  'airport':           ['aeropuerto', 'transporte', 'transfer'],
  'aeropuerto':        ['aeropuerto', 'transporte', 'transfer'],
  'boat':              ['lancha', 'barco', 'islas', 'transporte'],
  'lancha':            ['lancha', 'barco', 'islas', 'transporte'],
  'barco':             ['lancha', 'barco', 'islas', 'transporte'],
  'walk':              ['caminata', 'tour', 'paseo'],
  'caminar':           ['caminata', 'tour', 'paseo'],
  'run':               ['correr', 'ejercicio', 'parque'],
  'correr':            ['correr', 'ejercicio', 'parque'],
  'safe':              ['seguridad', 'zona segura'],
  'seguro':            ['seguridad', 'zona segura'],
  'safety':            ['seguridad', 'zona segura'],
  'dangerous':         ['seguridad', 'evitar'],
  'peligroso':         ['seguridad', 'evitar'],
  'emergency':         ['emergencia', 'policia', 'hospital'],
  'emergencia':        ['emergencia', 'policia', 'hospital'],
  'souvenir':          ['souvenir', 'artesania', 'recuerdo'],
  'recuerdo':          ['souvenir', 'artesania', 'recuerdo'],
  'regalo':            ['souvenir', 'artesania', 'recuerdo'],
  'gift':              ['souvenir', 'artesania', 'recuerdo'],
  'market':            ['mercado', 'artesania', 'local'],
  'mercado':           ['mercado', 'artesania', 'local'],

  // ── Beauty (existing) ──
  'makeup':            ['maquillaje', 'makeup'],
  'facial':            ['facial', 'estetica', 'tratamiento'],
  'lashes':            ['pestanas', 'cejas', 'lashes'],
  'beauty':            ['belleza', 'estetica', 'salon'],
  'salon':             ['salon', 'peluqueria', 'belleza'],

  // ── Bars / Nightlife (existing) ──
  'bars':              ['bar', 'coctel', 'rooftop'],
  'rooftop':           ['rooftop', 'terraza', 'bar'],
  'nightlife':         ['discoteca', 'bar', 'club', 'noche'],

  // ── Nature / Outdoors (existing) ──
  'beach':             ['playa', 'mar', 'islas'],
  'beaches':           ['playa', 'mar', 'islas'],
  'island':            ['isla', 'rosario'],
  'islands':           ['islas', 'rosario'],

  // ── Activities (existing) ──
  'tour':              ['tour', 'experiencia', 'recorrido'],
  'tours':             ['tour', 'experiencia', 'recorrido'],
  'spa':               ['spa', 'bienestar', 'masaje'],
  'wellness':          ['spa', 'bienestar', 'yoga'],
  'sunset':            ['atardecer', 'sunset'],
  'shopping':          ['compras', 'boutique', 'tienda'],
  'spanish':           ['espanol', 'colombiano'],

  // ── French equivalents ──
  'petit dejeuner':    ['desayuno', 'cafe', 'brunch'],
  'dejeuner':          ['almuerzo', 'restaurante', 'comida'],
  'diner':             ['cena', 'restaurante', 'comida'],
  'glace':             ['helados', 'postres'],
  'gateau':            ['pasteleria', 'postres', 'torta'],
  'boulangerie':       ['panaderia', 'pasteleria'],
  'jus':               ['jugos', 'cafe'],
  'ennuye':            ['experiencia', 'actividad', 'tour'],
  'fatigue':           ['spa', 'bienestar', 'masaje'],
  'detendre':          ['spa', 'playa', 'bienestar'],
  'aventure':          ['actividad', 'tour', 'deporte'],
  'romantique':        ['romantico', 'pareja', 'cena'],
  'fete':              ['fiesta', 'discoteca', 'club'],
  'anniversaire':      ['cumpleanos', 'fiesta', 'celebracion'],
  'mariage':           ['boda', 'evento', 'venue'],
  'pluie':             ['museo', 'shopping', 'spa'],
  'matin':             ['desayuno', 'cafe', 'yoga'],
  'cadeau':            ['souvenir', 'artesania', 'recuerdo'],
  'marche':            ['mercado', 'artesania', 'local'],
  'pharmacie':         ['farmacia'],
  'medecin':           ['clinica', 'hospital', 'medico'],
  'urgence':           ['emergencia', 'policia', 'hospital'],
  'aeroport':          ['aeropuerto', 'transporte', 'transfer'],
  'bateau':            ['lancha', 'barco', 'islas'],
  'nager':             ['playa', 'piscina'],
  'danser':            ['bailar', 'salsa', 'discoteca'],
  'musique':           ['musica en vivo', 'concierto'],
  'securite':          ['seguridad', 'zona segura'],

  // ── Portuguese equivalents ──
  'cafe da manha':     ['desayuno', 'cafe', 'brunch'],
  'almoco':            ['almuerzo', 'restaurante', 'comida'],
  'jantar':            ['cena', 'restaurante', 'comida'],
  'sorvete':           ['helados', 'postres'],
  'bolo':              ['pasteleria', 'postres'],
  'padaria':           ['panaderia', 'pasteleria'],
  'suco':              ['jugos', 'cafe'],
  'cerveja':           ['cerveceria', 'bar', 'cerveza'],
  'entediado':         ['experiencia', 'actividad', 'tour'],
  'relaxar':           ['spa', 'playa', 'bienestar'],
  'aventura pt':       ['actividad', 'tour', 'deporte'],
  'romantico pt':      ['romantico', 'pareja', 'cena'],
  'festa':             ['fiesta', 'discoteca', 'club'],
  'aniversario pt':    ['cumpleanos', 'fiesta', 'celebracion'],
  'casamento':         ['boda', 'evento', 'venue'],
  'chuva':             ['museo', 'shopping', 'spa'],
  'presente':          ['souvenir', 'artesania', 'recuerdo'],
  'farmacia pt':       ['farmacia'],
  'aeroporto':         ['aeropuerto', 'transporte', 'transfer'],
  'barco pt':          ['lancha', 'barco', 'islas'],
  'nadar':             ['playa', 'piscina'],
  'dancar':            ['bailar', 'salsa', 'discoteca'],
  'seguranca':         ['seguridad', 'zona segura'],
  'emergencia pt':     ['emergencia', 'policia', 'hospital'],

  // ── Museum / Culture ──
  'museum':            ['museo', 'cultura', 'historia'],
  'museo':             ['museo', 'cultura', 'historia'],
  'musee':             ['museo', 'cultura', 'historia'],
};

// Map common English category words to our partner.category values
const CATEGORY_HINTS: Record<string, string[]> = {
  restaurant: [
    'restaurant', 'restaurante', 'food', 'dining', 'comida', 'gastronomia',
    'hungry', 'hambre', 'eat', 'comer', 'manger',
    'fish', 'pescado', 'seafood', 'mariscos', 'ceviche', 'lobster', 'langosta', 'shrimp', 'camarones',
    'steak', 'carne', 'meat', 'viande', 'chicken', 'pollo',
    'pizza', 'pasta', 'italiana', 'sushi', 'ramen', 'asian', 'asiatica', 'japanese', 'japonesa',
    'tacos', 'mexican', 'mexicana', 'curry', 'indian',
    'brunch', 'breakfast', 'desayuno', 'lunch', 'almuerzo', 'dinner', 'cena',
    'wine', 'vino', 'fine dining', 'gourmet',
    'romantic', 'romantico', 'date night', 'anniversary', 'aniversario',
    'poisson', 'peixe', 'viande', 'petit dejeuner', 'dejeuner', 'diner', 'jantar',
    'cafe da manha', 'almoco',
  ],
  bar: [
    'bar', 'rooftop', 'cocktail', 'coctel', 'nightlife', 'discoteca',
    'drink', 'drinks', 'trago', 'tragos', 'cocteleria',
    'beer', 'cerveza', 'biere', 'cerveja',
    'rum', 'ron', 'tequila', 'mezcal', 'whisky', 'whiskey',
    'thirsty', 'sed',
    'pregame', 'happy hour', 'apero', 'aperitivo',
    'vibes', 'noche', 'night', 'soir', 'soiree', 'nuit',
    'karaoke', 'sports bar', 'bar deportivo',
  ],
  hotel: ['hotel', 'hospedaje', 'stay', 'lodging', 'pool', 'piscina'],
  experience: [
    'experience', 'experiencia', 'tour', 'recorrido', 'activity',
    'bored', 'aburrido', 'fun', 'divertido', 'diversion',
    'adventure', 'aventura',
    'walk', 'caminar', 'caminata', 'paseo',
  ],
  wellness: [
    'spa', 'wellness', 'yoga', 'bienestar', 'masaje', 'massage',
    'tired', 'cansado', 'relax', 'relajar', 'chill', 'tranquilo',
    'need rest', 'fatigue', 'detendre', 'relaxar',
  ],
  beauty: [
    'beauty', 'belleza', 'salon', 'peluqueria', 'barberia',
    'unas', 'maquillaje', 'estetica', 'pestanas', 'cejas',
    'nails', 'haircut', 'barber', 'makeup', 'facial',
    'hair', 'pelo', 'corte', 'lashes',
    'tattoo', 'tatuaje', 'manicure', 'pedicure',
  ],
  beach: [
    'beach', 'playa', 'island', 'isla', 'rosario',
    'hot', 'calor', 'swim', 'nadar', 'nager',
    'beach club', 'day pass',
  ],
  shopping: [
    'shopping', 'boutique', 'compras', 'tienda',
    'souvenir', 'recuerdo', 'regalo', 'gift', 'cadeau', 'presente',
    'market', 'mercado', 'artesania',
  ],
  service: [
    'money', 'dinero', 'cash', 'efectivo', 'atm', 'cajero', 'banco', 'bank',
    'taxi', 'uber', 'ride', 'transporte', 'transport',
    'airport', 'aeropuerto', 'aeroport', 'aeroporto',
    'laundry', 'lavanderia',
    'phone', 'telefono', 'celular', 'sim', 'wifi', 'internet', 'coworking',
    'pharmacy', 'farmacia', 'pharmacie', 'medicine',
    'sick', 'enfermo', 'doctor', 'medico', 'hospital', 'clinica',
    'emergency', 'emergencia', 'urgence',
    'safe', 'seguro', 'safety', 'seguridad', 'dangerous', 'peligroso',
  ],
  attraction: [
    'museum', 'museo', 'musee',
    'culture', 'cultura', 'historia', 'history',
    'castle', 'castillo', 'fortress', 'murallas', 'walls',
    'church', 'iglesia', 'cathedral', 'monument', 'monumento',
    'instagrammable', 'instagram', 'photo', 'selfie', 'fotografia',
  ],
  cafe: [
    'coffee', 'cafe', 'cafeteria', 'latte', 'cappuccino',
    'juice', 'jugo', 'jus', 'suco', 'smoothie',
    'bakery', 'panaderia', 'boulangerie', 'padaria',
    'cake', 'pastel', 'torta', 'gateau', 'bolo',
    'ice cream', 'helado', 'glace', 'sorvete',
    'postres', 'pasteleria',
  ],
  spa: [
    'spa', 'masaje', 'massage', 'bienestar', 'wellness',
    'yoga', 'meditation', 'meditacion',
    'relax', 'relajar', 'chill', 'tranquilo',
    'tired', 'cansado', 'need rest',
  ],
  transport: [
    'taxi', 'uber', 'ride', 'transporte',
    'airport', 'aeropuerto', 'aeroport', 'aeroporto',
    'boat', 'lancha', 'barco', 'bateau',
    'bus', 'transcaribe',
  ],
};

const expandQuery = (q: string): string[] => {
  const n = norm(q);
  const terms = new Set<string>([n]);
  // direct phrase match in SYNONYMS
  for (const key of Object.keys(SYNONYMS)) {
    if (n.includes(key)) {
      for (const syn of SYNONYMS[key]) terms.add(norm(syn));
    }
  }
  // also add each word from the query so partial matching works
  for (const word of n.split(/\s+/).filter(w => w.length >= 3)) {
    terms.add(word);
    if (SYNONYMS[word]) for (const syn of SYNONYMS[word]) terms.add(norm(syn));
  }
  return Array.from(terms);
};

const detectCategories = (q: string): string[] => {
  const n = norm(q);
  const cats: string[] = [];
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS)) {
    if (hints.some(h => n.includes(h))) cats.push(cat);
  }
  return cats;
};

const matchAny = (terms: string[], ...fields: any[]): boolean => {
  for (const t of terms) {
    if (!t) continue;
    for (const f of fields) {
      if (norm(f).includes(t)) return true;
    }
  }
  return false;
};

const staticSearch = async (path: string): Promise<any> => {
  // path is like '/search?q=foo&lang=es'
  const qs = path.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  const q = (params.get('q') || '').trim();
  if (!q || q.length < 2) {
    return { events: [], concerts: [], partners: [], venues: [], transport: [], partner_events: [] };
  }
  const cache = (await loadSearchCache())!;
  const terms = expandQuery(q);
  const cats  = detectCategories(q);

  // Knowledge-base boost: find partners mentioned in curated entries matching the query
  const knowledgeBoosted = await matchKnowledgeBoosted(q);

  let partners = cache.partners.filter((p: any) =>
    matchAny(terms, p.name, p.description, p.category, p.subcategory, p.address, p.cuisine)
  );

  // Add partners from knowledge base that weren't found by text match
  if (knowledgeBoosted.size > 0) {
    const seen = new Set(partners.map((p: any) => p.partner_id || p.id));
    const knowledgePartners = cache.partners.filter((p: any) => {
      const id = p.partner_id || p.id;
      if (seen.has(id)) return false;
      return knowledgeBoosted.has(norm(p.name));
    });
    for (const p of knowledgePartners) {
      partners.push(p);
      seen.add(p.partner_id || p.id);
    }
  }

  // Sort: knowledge-boosted partners first, then the rest
  if (knowledgeBoosted.size > 0) {
    partners.sort((a: any, b: any) => {
      const aBoost = knowledgeBoosted.has(norm(a.name)) ? 1 : 0;
      const bBoost = knowledgeBoosted.has(norm(b.name)) ? 1 : 0;
      return bBoost - aBoost;
    });
  }

  // If text match is sparse, fall back to category match so we always have something to show
  if (partners.length < 5 && cats.length > 0) {
    const byCat = cache.partners.filter((p: any) => {
      const pc = norm(p.category);
      return cats.some(c => pc.includes(c));
    });
    const seen = new Set(partners.map((p: any) => p.partner_id || p.id));
    for (const p of byCat) {
      const id = p.partner_id || p.id;
      if (!seen.has(id)) { partners.push(p); seen.add(id); }
      if (partners.length >= 20) break;
    }
  }
  partners = partners.slice(0, 20);

  const events = cache.events.filter((e: any) =>
    matchAny(terms, e.title, e.description, e.type, e.category, e.venue_name)
  ).slice(0, 20);
  const concerts = cache.concerts.filter((c: any) =>
    matchAny(terms, c.title, c.artist, c.genre, c.venue_name, c.description)
  ).slice(0, 20);
  const partner_events = cache.partner_events.filter((pe: any) =>
    matchAny(terms, pe.title, pe.category, pe.partner_name)
  ).slice(0, 20);
  const transport = cache.transport.filter((t: any) =>
    matchAny(terms, t.name, t.type, t.description, t.destination)
  ).slice(0, 10);
  const venues = cache.venues.filter((v: any) =>
    matchAny(terms, v.name, v.description, v.type, v.address)
  ).slice(0, 10);
  return { events, concerts, partners, venues, transport, partner_events };
};

// Optional AI enrichment via a server-side proxy that holds the Anthropic key.
// Adds `ai` payload to the result. Silently no-ops if the proxy is missing.
const tryAIEnrich = async (q: string, lang: string, base: any): Promise<any> => {
  if (!AI_PROXY_URL) return base;
  try {
    // Always give Claude a generous candidate pool. If the filtered search
    // returned few partners (e.g. EN query against ES data), top up from the
    // detected categories so the concierge always has something real to suggest.
    const cache = await loadSearchCache();
    const cats = detectCategories(q);
    const seen = new Set<string>();
    const candPartners: any[] = [];
    const pushPartner = (p: any) => {
      const id = p.partner_id || p.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      candPartners.push({
        id, name: p.name, category: p.category, subcategory: p.subcategory,
        zone: p.address || p.zone, cuisine: p.cuisine,
      });
    };
    for (const p of (base.partners || [])) pushPartner(p);
    if (cache && cats.length) {
      for (const p of cache.partners) {
        if (candPartners.length >= 15) break;
        if (cats.some(c => norm(p.category).includes(c))) pushPartner(p);
      }
    }
    // If still thin, send top partners overall (premium tier first if present)
    if (cache && candPartners.length < 8) {
      const ranked = [...cache.partners].sort((a: any, b: any) => {
        const ta = (a.tier === 'premium' || a.tier === 'gold') ? 0 : 1;
        const tb = (b.tier === 'premium' || b.tier === 'gold') ? 0 : 1;
        return ta - tb;
      });
      for (const p of ranked) {
        if (candPartners.length >= 12) break;
        pushPartner(p);
      }
    }

    const candEvents = (base.events || []).slice(0, 8).map((e: any) => ({
      id: e.event_id || e.id, title: e.title, type: e.type, date: e.date, venue: e.venue_name,
    }));

    const res = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, lang, hits: { partners: candPartners, events: candEvents } }),
    });
    if (!res.ok) return base;
    const ai = await res.json();
    return { ...base, ai };
  } catch { /* AI enrichment unavailable — return base results without AI */ }
  return base;
};

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
};

const buildHeaders = async (override?: Record<string, string>): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!override?.Authorization) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return { ...headers, ...(override || {}) };
};

// On web with cross-origin backend, credentials: 'include' causes Safari/iOS
// to block responses unless the server sends Access-Control-Allow-Credentials
// with a specific origin (not wildcard). Use 'same-origin' for web to avoid
// this; auth is handled via Bearer token header instead of cookies.
const CREDS: RequestCredentials = Platform.OS === 'web' ? 'same-origin' : 'include';

type Opts = { headers?: Record<string, string> };

export const api = {
  get: async (path: string, opts?: Opts) => {
    // Static mode → read from bundled /data/*.json
    if (STATIC_MODE) {
      // Special: /search must be computed client-side over the static catalogs
      if (path.startsWith('/search')) {
        const qs = path.split('?')[1] || '';
        const params = new URLSearchParams(qs);
        const q = (params.get('q') || '').trim();
        const lang = params.get('lang') || 'es';
        const base = await staticSearch(path);
        return await tryAIEnrich(q, lang, base);
      }
      const data = await tryStatic(path);
      if (data !== null) return data;
      // Unknown endpoint in static mode — return safe empty
      return [];
    }
    try {
      const headers = await buildHeaders(opts?.headers);
      const res = await fetch(`${BACKEND_URL}/api${path}`, { headers, credentials: CREDS });
      if (!res.ok) {
        // Network OK but backend errored → try static fallback before throwing
        const fallback = await tryStatic(path);
        if (fallback !== null) return fallback;
        throw new Error(`GET ${path} failed: ${res.status}`);
      }
      return res.json();
    } catch (err) {
      // Network failure / timeout (backend down) → try static fallback
      const fallback = await tryStatic(path);
      if (fallback !== null) return fallback;
      throw err;
    }
  },
  post: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) {
      // No-op write — return body or empty object so UI optimistically updates
      return body ?? {};
    }
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'POST',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `POST ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch { /* response body not JSON — use status code message */ }
      throw new Error(msg);
    }
    return res.json();
  },
  put: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return body ?? {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PUT',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
  },
  patch: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return body ?? {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PATCH',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `PATCH ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch { /* response body not JSON — use status code message */ }
      throw new Error(msg);
    }
    return res.json();
  },
  delete: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'DELETE',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: CREDS,
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  },
};
