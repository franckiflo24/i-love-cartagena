// City hub ("Moverse") — shared types + helpers for /ciudad and /ciudad/[id].
//
// Data source: api.get('/city/modules') → backend GET /api/city/modules, which
// falls back to the static /data/city/modules.json (same payload) on any public
// GET failure. One in-memory cache serves hub → detail without a refetch and
// keeps the detail usable when the network drops after the hub loaded.
//
// Honesty system (non-negotiable): status is info | proximamente | en_vivo.
// en_vivo requires a signed agreement (none exist). AMO informs; it never sells
// or operates any of these services — copy always says where to pay off-app.
import { Linking, Platform } from 'react-native';
import { api } from '../constants/api';
import { COLORS } from '../constants/theme';
import type { Lang } from '../i18n/translations';

export type L4 = { es: string; en?: string; fr?: string; pt?: string };
export type CityStatus = 'info' | 'proximamente' | 'en_vivo';
export type CityConfidence = 'HIGH' | 'VERIFY';
export type CityLinkKind = 'official' | 'tickets' | 'map' | 'report' | 'recharge';

export type CityFact = {
  key: string;
  label: L4;
  value_cop: number | null;
  value_text: L4 | null;
  confidence: CityConfidence;
  source_url: string;
  source_name: string;
  source_date?: string;
  last_verified: string;
  note?: L4 | null;
};

export type CityLink = { label: L4; url: string; kind: CityLinkKind };

export type CityImage = {
  file: string;
  creator?: string;
  license?: string;
  source_url?: string;
  // Required when the photo is context, not the subject (coches-electricos ships a
  // Plaza de Santo Domingo street scene, not an electric carriage): rendered under
  // the hero and used as the image's accessibility label.
  caption?: L4 | null;
};

export type CityModule = {
  id: string;
  order: number;
  icon: string;
  status: CityStatus;
  status_reason: L4;
  title: L4;
  tagline: L4;
  summary: L4;
  honest_note: L4;
  facts: CityFact[];
  official_links: CityLink[];
  safety: L4[];
  fallback: L4;
  future?: L4 | null;
  image: CityImage | null;
};

export type CityModulesPayload = {
  version: string;
  last_verified: string;
  source_doc?: string;
  modules: CityModule[];
};

// ── 4-language picker: <lang> → en → es → '' ─────────────────────────────────
export const pickL = (o: L4 | null | undefined, lang: Lang): string =>
  (o && (o[lang] || o.en || o.es)) || '';

// ── COP formatting — matches the module copy's house style per language so the
// bold value never disagrees with its own value_text one line below:
//   es "COP 3.900" · pt "COP 3.900" · en "COP 3,900" · fr "3 900 COP" (narrow
//   no-break space, currency after the number, as French copy writes it).
// Manual grouping: no Intl dependency, so Hermes on iOS and the static web
// export render the same string. 0 is handled by the screen (tr('GRATIS')).
const COP_SEP: Record<Lang, string> = { es: '.', pt: '.', en: ',', fr: ' ' };
export const formatCop = (n: number, lang: Lang): string => {
  const sep = COP_SEP[lang] || ',';
  const grouped = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const signed = `${n < 0 ? '-' : ''}${grouped}`;
  return lang === 'fr' ? `${signed} COP` : `COP ${signed}`;
};

// ── Status badge meta. Labels are Spanish source text — pass through tr(). ───
export const STATUS_META: Record<CityStatus, { label: string; color: string; bg: string; icon: string }> = {
  info:         { label: 'Info',         color: COLORS.primary, bg: 'rgba(18,181,165,0.12)', icon: 'information-circle-outline' },
  proximamente: { label: 'Próximamente', color: COLORS.mustard, bg: 'rgba(233,185,73,0.14)', icon: 'time-outline' },
  en_vivo:      { label: 'En vivo',      color: COLORS.coral,   bg: 'rgba(255,107,74,0.14)', icon: 'flash-outline' },
};

export const isCityStatus = (s: unknown): s is CityStatus =>
  s === 'info' || s === 'proximamente' || s === 'en_vivo';

// ── Brand gradient per module (icon-art fallback + hero tint). ───────────────
const DEFAULT_GRADIENT: readonly [string, string] = ['#12B5A5', '#0C7D72'];
const MODULE_GRADIENTS: Record<string, readonly [string, string]> = {
  'transcaribe':          ['#F59E0B', '#DC2626'],  // Transcaribe orange-red livery
  'muelle-bodeguita':     ['#38BDF8', '#1E3A8A'],  // bay blue
  'monumentos':           ['#E9B949', '#92400E'],  // coral-stone gold
  'coches-electricos':    ['#34D399', '#0F766E'],  // electric green
  'transcaribe-acuatico': ['#22D3EE', '#0E7490'],  // water cyan
  'taxis':                ['#FACC15', '#A16207'],  // taxi yellow
};
export const gradientFor = (id: string): readonly [string, string] =>
  MODULE_GRADIENTS[id] || DEFAULT_GRADIENT;

// ── Published module ids (mirror of /data/city/modules.json) ─────────────────
// Luna's `open_city_module` action carries a module_id chosen by the model; an
// unknown or missing id must land on the hub, never on the detail's not-found
// state or a 404.
export const CITY_MODULE_IDS = [
  'transcaribe', 'muelle-bodeguita', 'monumentos', 'coches-electricos', 'transcaribe-acuatico', 'taxis',
] as const;
export type CityModuleId = typeof CITY_MODULE_IDS[number];
export const isCityModuleId = (id: unknown): id is CityModuleId =>
  typeof id === 'string' && (CITY_MODULE_IDS as readonly string[]).includes(id);
export const cityModuleRoute = (id: unknown): string =>
  isCityModuleId(id) ? `/ciudad/${id}` : '/ciudad';

// ── Official-link icons by kind ─────────────────────────────────────────────
export const LINK_ICONS: Record<CityLinkKind, string> = {
  official: 'globe-outline',
  tickets:  'ticket-outline',
  map:      'map-outline',
  report:   'megaphone-outline',
  recharge: 'card-outline',
};

// ── Official-link display order ─────────────────────────────────────────────
// The JSON lists decrees and PDFs first, so the two links a visitor actually
// acts on (buy / find) sat at positions 5 and 8 under a full screen of buttons.
// Actionable kinds come first; the sort is stable, so JSON order holds within a
// kind. The detail shows the top 3 and expands to the rest on demand.
export const LINK_PRIORITY: Record<CityLinkKind, number> = {
  tickets: 0, map: 1, recharge: 2, official: 3, report: 4,
};
export const sortLinksByPriority = (links: CityLink[]): CityLink[] =>
  [...links].sort((a, b) => (LINK_PRIORITY[a.kind] ?? 9) - (LINK_PRIORITY[b.kind] ?? 9));

// ── Loader with cache ───────────────────────────────────────────────────────
let CACHE: CityModulesPayload | null = null;

const isL4 = (v: unknown): v is L4 =>
  !!v && typeof v === 'object' && typeof (v as L4).es === 'string';

const normalize = (raw: unknown): CityModulesPayload | null => {
  const obj = (Array.isArray(raw) ? { modules: raw } : raw) as Partial<CityModulesPayload> | null;
  if (!obj || !Array.isArray(obj.modules)) return null;
  const modules = (obj.modules as unknown[])
    .filter((m): m is CityModule => {
      const x = m as Partial<CityModule> | null;
      return !!x && typeof x.id === 'string' && isL4(x.title) && isCityStatus(x.status);
    })
    .map((m) => ({
      ...m,
      facts: Array.isArray(m.facts) ? m.facts : [],
      official_links: Array.isArray(m.official_links) ? m.official_links : [],
      safety: Array.isArray(m.safety) ? m.safety : [],
      image: m.image && typeof m.image.file === 'string' ? m.image : null,
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    version: typeof obj.version === 'string' ? obj.version : '',
    last_verified: typeof obj.last_verified === 'string' ? obj.last_verified : '',
    source_doc: typeof obj.source_doc === 'string' ? obj.source_doc : undefined,
    modules,
  };
};

export const getCachedCityModules = (): CityModulesPayload | null => CACHE;

export async function loadCityModules(force = false): Promise<CityModulesPayload> {
  if (CACHE && !force) return CACHE;
  const raw = await api.get('/city/modules');
  const payload = normalize(raw);
  if (!payload) throw new Error('city/modules: unexpected payload shape');
  CACHE = payload;
  return payload;
}

// ── External links: new tab on web (noopener), system handler on native. ────
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await Linking.openURL(url);
  } catch (e) {
    console.error('[cityModules] openExternal', url, e);
  }
}
