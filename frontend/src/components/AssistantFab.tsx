/**
 * Floating AI Concierge Assistant ("Luna") — global FAB + chat sheet.
 * Lives at the root of the (tabs) layout and is visible everywhere except inside
 * already-modal screens.
 *
 * Visual identity: Luna's signature accent is purple (TIER_COLORS.elite / #A855F7,
 * already used app-wide for the "elite" partner tier and the nightlife category) —
 * reserved for HER chrome only (FAB, avatar, message bubbles, quick-prompt chips).
 * Teal (COLORS.primary) stays reserved for primary actions (send button, in-chat
 * navigation CTAs) per the app's own "teal = primary actions only" rule. The
 * venues Luna recommends keep their OWN colorForKey() category color on their
 * cards — never purple-washed, so the app never reads monochrome.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS, FONTS, ELEVATION, TIER_COLORS, colorForKey } from '../constants/theme';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { Lang } from '../i18n/translations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import AddToTrip from './AddToTrip';
import { SafeImage } from './SafeImage';
import { loadCatalog, matchCatalog, type CatalogVenue } from '../lib/lunaOffline';
import { safeNext } from '../lib/safeNext';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const CONCIERGE_URL = process.env.EXPO_PUBLIC_CONCIERGE_URL || `${BACKEND_URL}/api/agent/chat`;
// Guest-facing "taste" endpoint — POST /api/agent/taste (backend/server.py ~7268).
// Unauthenticated by design: no Authorization header, no session_id/history, cheap
// Haiku tier server-side (`fast: true`). Hard-capped 1 call/IP/day + a global daily
// ceiling — a guest's 2nd free exchange in THIS sheet often still 429s there, which
// is fine: the guest branch below treats that exactly like any other failure
// (instant local cards + the existing warm fallback copy), never a hard error.
const TASTE_URL = `${BACKEND_URL}/api/agent/taste`;

// ── Luna's identity accent — sourced from theme.ts's own "elite" tier token so
// this stays in lockstep with the rest of the app instead of inventing a new
// color. expo-linear-gradient requires a literal 2+ color tuple (theme.ts's
// TIER_COLORS.elite.gradient is a loose string[]), so the two stops are mirrored
// here as a local `as const` tuple. ──────────────────────────────────────────
const LUNA_ACCENT = TIER_COLORS.elite.main;           // '#A855F7'
const LUNA_GRADIENT = ['#7E22CE', '#C084FC'] as const; // mirrors TIER_COLORS.elite.gradient
const LUNA_TINT = 'rgba(168, 85, 247, 0.10)';          // assistant bubble / chip wash
const LUNA_TINT_BORDER = 'rgba(168, 85, 247, 0.30)';   // assistant bubble / chip hairline

type Action = {
  type: string;
  label?: string;
  // Variants:
  partner_id?: string;
  event_id?: string;
  screen?: string;
  filters?: Record<string, any>;
  qty?: number;
  travel_date?: string;
  plan_id?: string;
  category?: string;
  url?: string;
};

type Recommendation = {
  kind: 'partner' | 'event';
  partner_id?: string;
  event_id?: string;
  name: string;
  type?: string;
  vibe?: string;
  price_range?: string;
  address?: string;
  reason?: string;
  // Resolved CLIENT-SIDE from the bundled catalog (never sent by the backend —
  // ai_agent.py's _sanitize_recommendations schema has no image/category field).
  // Partner recs only; events have no local image source.
  image?: string;
  category?: string;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  recommendations?: Recommendation[];
  suggestions?: string[];
  language?: string;
  created_at?: string;
  provisional?: boolean;   // instant local results shown while Luna (Sonnet) thinks
  isWelcome?: boolean;     // the first-open hero greeting — renders the quick-prompt showcase
};

const STORAGE_SESSION_KEY = 'amo_agent_session_id';
// Set right before a guest is routed to /login from their free-exchange ceiling;
// consumed the moment `user` resolves truthy so the sheet reopens automatically —
// signing up to keep talking to Luna should never cost the guest their place.
const STORAGE_REOPEN_KEY = 'amo_reopen_assistant';
// Guests get this many real AI (agent/taste) attempts per FAB session before the
// conversion invite replaces further attempts. Deliberately a component-state
// counter, not persisted — it does NOT relax the backend's own 1-call/IP/day cap
// on /agent/taste (see TASTE_URL above); it only bounds how many times THIS sheet
// tries the network before asking the guest to sign up.
const GUEST_FREE_EXCHANGES = 2;

// Real venues from the bundled catalog → concierge recommendation cards. Used for
// the instant preview (perceived speed) AND the fallback when Luna is slow/errors,
// so the guest ALWAYS gets real places instead of a dead "Tuve un problema".
function venuesToRecs(venues: CatalogVenue[], lang: Lang): Recommendation[] {
  const en = lang.startsWith('en');
  return venues.map((v) => ({
    kind: 'partner' as const,
    partner_id: v.partner_id,
    name: v.name,
    type: (en ? v.display_en : v.display_es) || v.category,
    price_range: v.price_range,
    address: v.zone || (v.address ? v.address.split(',')[0] : ''),
    image: v.image,
    category: v.category,
  }));
}

// The LIVE Sonnet reply never includes an image or raw category key. Backfill
// both client-side from the same bundled catalog already loaded for the instant
// preview, by partner_id. Events have no local image source and pass through
// unchanged.
function enrichRecommendations(recs: Recommendation[], catalog: CatalogVenue[]): Recommendation[] {
  if (!recs.length || !catalog.length) return recs;
  // `as const` forces a tuple (not a loose array) so Map's <K,V> infers correctly.
  const byId = new Map(catalog.map((v) => [v.partner_id, v] as const));
  return recs.map((r) => {
    if (r.kind !== 'partner' || !r.partner_id) return r;
    const cv = byId.get(r.partner_id);
    if (!cv) return r;
    return { ...r, image: r.image || cv.image, category: r.category || cv.category };
  });
}

// ── i18n tables — all 4 langs, ES/EN/FR/PT ───────────────────────────────────

// Resilience copy: shown when Luna is slow/errors/times out. Warm and grounded
// in "the connection is slow", never "I failed you" — in character, not
// apologetic-robotic.
const FAB_STR: Record<Lang, { preview: string; slow: string; nohit: string }> = {
  es: {
    preview: 'Ideas al instante mientras Luna arma la respuesta completa:',
    slow: 'Luna le sigue dando vueltas a tu respuesta — mientras, esto es real y está cerca:',
    nohit: 'La señal está lenta por acá. Probá de nuevo en un momento y seguimos 🙏',
  },
  en: {
    preview: 'Instant ideas while Luna puts together the full answer:',
    slow: "Luna's still thinking it through — meanwhile, here's what's real and nearby:",
    nohit: "Signal's a little slow right now. Try again in a moment and we'll pick up here 🙏",
  },
  fr: {
    preview: 'Des idées immédiates pendant que Luna prépare la réponse complète :',
    slow: 'Luna y réfléchit encore — en attendant, voici de vraies options tout près :',
    nohit: 'La connexion est un peu lente en ce moment. Réessayez dans un instant 🙏',
  },
  pt: {
    preview: 'Ideias na hora enquanto a Luna prepara a resposta completa:',
    slow: 'A Luna ainda está pensando nisso — enquanto isso, opções reais e por perto:',
    nohit: 'O sinal está lento agora. Tente de novo em instante que a gente continua 🙏',
  },
};

// Guests get GUEST_FREE_EXCHANGES real AI exchanges (via /agent/taste, no auth)
// before this fires — never a cold wall on message #1. By the time a guest sees
// this they've already tasted Luna for real, so the copy reinforces what they'd
// KEEP (not what they're missing), and routes through the same login/signup CTA.
const GUEST_LIMIT: Record<Lang, { msg: string; cta: string }> = {
  es: { msg: 'Creá tu cuenta gratis y sigo siendo tu concierge, sin límites 🌙', cta: 'Crear cuenta gratis' },
  en: { msg: "Create a free account and I'll keep being your concierge — no limits 🌙", cta: 'Create free account' },
  fr: { msg: 'Créez un compte gratuit et je reste votre concierge — sans limites 🌙', cta: 'Créer un compte gratuit' },
  pt: { msg: 'Crie uma conta grátis e eu continuo sendo sua concierge — sem limites 🌙', cta: 'Criar conta grátis' },
};

// First-open greeting. 🌙 ties the emoji to the name, not the generic 🌴.
const WELCOME: Record<Lang, string> = {
  es: '¡Hola! Soy Luna 🌙 tu concierge de Cartagena. Conozco la ciudad de memoria — dónde comer, dónde bailar, el mejor atardecer, cómo llegar a las islas. ¿Qué se te antoja?',
  en: "Hi, I'm Luna 🌙 your Cartagena concierge. I know this city inside out — where to eat, where to dance, the best sunset, how to reach the islands. What are you in the mood for?",
  fr: 'Bonjour, je suis Luna 🌙 votre concierge à Carthagène. Je connais la ville par cœur — où manger, où danser, le plus beau coucher de soleil, comment rejoindre les îles. Dites-moi ce que vous cherchez.',
  pt: 'Oi, eu sou a Luna 🌙 sua concierge em Cartagena. Conheço a cidade de cor — onde comer, onde dançar, o melhor pôr do sol, como chegar às ilhas. O que você está a fim de fazer?',
};

type QuickPrompt = { icon: keyof typeof Ionicons.glyphMap; text: string };

// Showcase chips on first open — tapping one sends it through the exact same
// send() path as typing it, so it's never a dead-end preview.
const QUICK_PROMPTS: Record<Lang, QuickPrompt[]> = {
  es: [
    { icon: 'heart-outline', text: 'Cena romántica esta noche' },
    { icon: 'sunny-outline', text: 'Mejor rooftop para el atardecer' },
    { icon: 'people-outline', text: 'Plan para hoy con niños' },
    { icon: 'musical-notes-outline', text: '¿Dónde bailar salsa?' },
    { icon: 'flower-outline', text: 'Spa & relax' },
    { icon: 'flash-outline', text: '¿Qué está pasando ahora?' },
  ],
  en: [
    { icon: 'heart-outline', text: 'Romantic dinner tonight' },
    { icon: 'sunny-outline', text: 'Best rooftop for sunset' },
    { icon: 'people-outline', text: 'Family plan for today' },
    { icon: 'musical-notes-outline', text: 'Where to dance salsa?' },
    { icon: 'flower-outline', text: 'Spa & relax' },
    { icon: 'flash-outline', text: "What's happening right now?" },
  ],
  fr: [
    { icon: 'heart-outline', text: 'Dîner romantique ce soir' },
    { icon: 'sunny-outline', text: 'Meilleur rooftop pour le coucher du soleil' },
    { icon: 'people-outline', text: 'Plan du jour en famille' },
    { icon: 'musical-notes-outline', text: 'Où danser la salsa ?' },
    { icon: 'flower-outline', text: 'Spa & détente' },
    { icon: 'flash-outline', text: "Qu'est-ce qui se passe maintenant ?" },
  ],
  pt: [
    { icon: 'heart-outline', text: 'Jantar romântico esta noite' },
    { icon: 'sunny-outline', text: 'Melhor rooftop para o pôr do sol' },
    { icon: 'people-outline', text: 'Plano de hoje com crianças' },
    { icon: 'musical-notes-outline', text: 'Onde dançar salsa?' },
    { icon: 'flower-outline', text: 'Spa & relaxamento' },
    { icon: 'flash-outline', text: 'O que está rolando agora?' },
  ],
};

// Fallback labels for backend actions that omit `label` (the system prompt
// asks Sonnet for one in the detected language, so this mostly covers the
// client-constructed login-wall action and any edge-case gap).
const ACTION_LABELS: Record<Lang, Record<string, string>> = {
  es: { navigate: 'Ir a', show_partners: 'Ver partners', show_events: 'Ver eventos', open_partner: 'Ver partner', open_event: 'Ver evento', open_port_tax_checkout: 'Comprar Tasa Portuaria', open_city_pass: 'Comprar City Pass', reservation_link: 'Reservar', show_itinerary: 'Ver itinerario', external_link: 'Abrir', default: 'Acción' },
  en: { navigate: 'Go to', show_partners: 'View partners', show_events: 'View events', open_partner: 'View partner', open_event: 'View event', open_port_tax_checkout: 'Buy Port Tax', open_city_pass: 'Buy City Pass', reservation_link: 'Book', show_itinerary: 'View itinerary', external_link: 'Open', default: 'Action' },
  fr: { navigate: 'Aller à', show_partners: 'Voir les partenaires', show_events: 'Voir les événements', open_partner: 'Voir le partenaire', open_event: "Voir l'événement", open_port_tax_checkout: 'Acheter la taxe portuaire', open_city_pass: 'Acheter le City Pass', reservation_link: 'Réserver', show_itinerary: "Voir l'itinéraire", external_link: 'Ouvrir', default: 'Action' },
  pt: { navigate: 'Ir para', show_partners: 'Ver parceiros', show_events: 'Ver eventos', open_partner: 'Ver parceiro', open_event: 'Ver evento', open_port_tax_checkout: 'Comprar Taxa Portuária', open_city_pass: 'Comprar City Pass', reservation_link: 'Reservar', show_itinerary: 'Ver roteiro', external_link: 'Abrir', default: 'Ação' },
};

function defaultLabel(a: Action, lang: Lang): string {
  const L = ACTION_LABELS[lang] || ACTION_LABELS.es;
  if (a.type === 'navigate') return `${L.navigate} ${a.screen || ''}`.trim();
  return L[a.type] || L.default;
}

// Recommendation card chrome text.
const RECOMMENDATION_LABELS: Record<Lang, { event: string; partner: string; viewEvent: string; viewPartner: string }> = {
  es: { event: 'Evento', partner: 'Partner', viewEvent: 'Ver evento', viewPartner: 'Ver partner' },
  en: { event: 'Event', partner: 'Partner', viewEvent: 'View event', viewPartner: 'View partner' },
  fr: { event: 'Événement', partner: 'Partenaire', viewEvent: "Voir l'événement", viewPartner: 'Voir le partenaire' },
  pt: { event: 'Evento', partner: 'Parceiro', viewEvent: 'Ver evento', viewPartner: 'Ver parceiro' },
};

const FAB_A11Y: Record<Lang, string> = {
  es: 'Luna, tu concierge de Cartagena',
  en: 'Luna, your Cartagena concierge',
  fr: 'Luna, votre concierge à Carthagène',
  pt: 'Luna, sua concierge em Cartagena',
};

// ── Motion — respects prefers-reduced-motion ─────────────────────────────────
// RNW maps this to `matchMedia('(prefers-reduced-motion: reduce)')`; native
// reads the OS accessibility setting. Every decorative loop below checks it.
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled: boolean) => setReduced(enabled));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

// Gentle scale breathing on the FAB.
function usePulse(reduced: boolean) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 1100, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(scale, { toValue: 1.0, duration: 1100, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale, reduced]);
  return scale;
}

// Slow outward ripple ring behind the FAB — Luna's "alive" signal.
function useHalo(reduced: boolean) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [t, reduced]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const opacity = t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.35, 0.12, 0] });
  return { scale, opacity };
}

function LunaAvatar({ size = 32 }: { size?: number }) {
  return (
    <LinearGradient
      colors={LUNA_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.lunaAvatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Ionicons name="sparkles" size={Math.max(12, Math.round(size * 0.5))} color={COLORS.white} />
    </LinearGradient>
  );
}

export default function AssistantFab({ hideFab = false }: { hideFab?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { lang, s } = useLang();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Guest-only: real AI attempts used in THIS mounted session (see GUEST_FREE_EXCHANGES
  // above). Never read or reset for logged-in users.
  const [guestExchangeCount, setGuestExchangeCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const reducedMotion = useReducedMotion();
  const pulse = usePulse(reducedMotion);
  const halo = useHalo(reducedMotion);

  // Allow opening the assistant from anywhere via DeviceEventEmitter
  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub = DeviceEventEmitter.addListener('openAssistant', (initialQuery?: string) => {
      setOpen(true);
      if (initialQuery && typeof initialQuery === 'string' && initialQuery.trim()) {
        setInput(initialQuery);
      }
    });
    return () => sub.remove();
  }, []);

  // Restore last session from localStorage / AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const sid = localStorage.getItem(STORAGE_SESSION_KEY);
          if (sid) setSessionId(sid);
        } else {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const sid = await AsyncStorage.getItem(STORAGE_SESSION_KEY);
          if (sid) setSessionId(sid);
        }
      } catch { /* session restore from storage unavailable — start fresh */ }
    })();
  }, []);

  // Guest signed up specifically to keep chatting with Luna (their free-exchange
  // ceiling routed them to /login, see onAction's 'login' case) — reopen the sheet
  // the instant auth resolves. AssistantFab lives inside app/(tabs)/_layout.tsx, so
  // navigating to the top-level /login route unmounts it entirely; this effect on
  // the FRESH mount after returning is what makes "come back to where you were"
  // real instead of just a promise in the copy. No-ops for every OTHER login —
  // the flag is only ever set right before that one specific navigation.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        let flag: string | null = null;
        if (Platform.OS === 'web') {
          flag = sessionStorage.getItem(STORAGE_REOPEN_KEY);
          if (flag) sessionStorage.removeItem(STORAGE_REOPEN_KEY);
        } else {
          flag = await AsyncStorage.getItem(STORAGE_REOPEN_KEY);
          if (flag) await AsyncStorage.removeItem(STORAGE_REOPEN_KEY);
        }
        if (flag) setOpen(true);
      } catch { /* reopen-hint unavailable — sheet just stays closed, non-critical */ }
    })();
  }, [user]);

  // Welcome message when opening with no messages
  useEffect(() => {
    if (open && messages.length === 0 && !sessionId) {
      setMessages([{ role: 'assistant', content: WELCOME[lang] || WELCOME.es, isWelcome: true }]);
    }
  }, [open, messages.length, sessionId, lang]);

  // Keep the sheet scrolled to the latest turn whenever it's (re)opened.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const persistSession = useCallback(async (sid: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(STORAGE_SESSION_KEY, sid);
      } else {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        await AsyncStorage.setItem(STORAGE_SESSION_KEY, sid);
      }
    } catch { /* session persist to storage failed — non-critical */ }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed || sending) return;

      // ── GUEST ────────────────────────────────────────────────────────────
      // No login wall on message #1: guests get GUEST_FREE_EXCHANGES real AI
      // exchanges via the unauthenticated /agent/taste endpoint (same free-taste
      // pattern already live in app/concierge.tsx), each preceded by the SAME
      // instant local-catalog preview the logged-in path uses below — so Luna
      // answers with real venues on the very first message, guest or not.
      if (!user) {
        // Free-exchange ceiling hit for THIS sheet session → graceful conversion,
        // never a cold wall: Luna still replies, in character, with the login/
        // signup CTA attached.
        if (guestExchangeCount >= GUEST_FREE_EXCHANGES) {
          const g = GUEST_LIMIT[lang] || GUEST_LIMIT.es;
          setMessages((prev) => [
            ...prev,
            { role: 'user', content: trimmed },
            { role: 'assistant', content: g.msg, actions: [{ type: 'navigate', screen: 'login', label: g.cta }] },
          ]);
          return;
        }

        setSending(true);
        setInput('');
        const gStrs = FAB_STR[lang] || FAB_STR.es;
        setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);

        // Instant local preview — identical mechanism to the authed path below.
        let gCatalog: CatalogVenue[] = [];
        let gLocalRecs: Recommendation[] = [];
        try {
          gCatalog = await loadCatalog();
          const { venues, cats, tags } = matchCatalog(gCatalog, trimmed, 6);
          if (venues.length && (cats.size || tags.size || venues.length >= 3)) {
            gLocalRecs = venuesToRecs(venues, lang);
          }
        } catch { /* bundled catalog unavailable — fall through to the typing indicator */ }
        if (gLocalRecs.length) {
          setMessages((prev) => [...prev, { role: 'assistant', content: gStrs.preview, recommendations: gLocalRecs, provisional: true }]);
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: '__typing__' }]);
        }

        const clearGuestTransient = (list: Message[]) => list.filter((m) => m.content !== '__typing__' && !m.provisional);

        try {
          // Bound the wait exactly like the authed call below — and remember
          // /agent/taste also hard 429s once this IP has used its 1 free call
          // today; that lands here too, treated like any other failure.
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 14000);
          let tasteRes: Response;
          try {
            tasteRes = await fetch(TASTE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: trimmed, language: lang }),
              signal: ctrl.signal,
            });
          } finally { clearTimeout(timer); }
          if (!tasteRes.ok) throw new Error(`HTTP ${tasteRes.status}`);
          const res = await tasteRes.json();
          const a = res.assistant; // { message, language, recommendations, suggestions } — NOTE: `message`, not `content`
          const enriched = enrichRecommendations(a.recommendations || [], gCatalog);
          setMessages((prev) => [
            ...clearGuestTransient(prev),
            {
              role: 'assistant',
              content: a.message,
              actions: a.actions || [],
              // A 200 with zero recs must not erase the real venues already shown
              // by the provisional local preview — fall back to those instead of
              // letting the cards vanish.
              recommendations: enriched.length ? enriched : gLocalRecs,
              suggestions: a.suggestions || [],
              language: a.language,
            },
          ]);
        } catch {
          // Taste slow / errored / already used today (429) → keep the guest
          // moving with REAL venues, never a dead error.
          setMessages((prev) => {
            const next = clearGuestTransient(prev);
            if (gLocalRecs.length) {
              return [...next, { role: 'assistant', content: gStrs.slow, recommendations: gLocalRecs }];
            }
            return [...next, { role: 'assistant', content: gStrs.nohit }];
          });
        }
        setGuestExchangeCount((c) => c + 1);
        setSending(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
        return;
      }

      setSending(true);
      setInput('');
      const strs = FAB_STR[lang] || FAB_STR.es;
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);

      // Instant local preview: real venues from the bundled catalog shown WHILE Luna
      // (Sonnet, ~10-15s) thinks — so a venue query feels instant, and if Luna is slow
      // or errors we still have real places to show instead of a dead error. `catalog`
      // stays in scope to also backfill image/category on the LIVE Sonnet recs below.
      let catalog: CatalogVenue[] = [];
      let localRecs: Recommendation[] = [];
      try {
        catalog = await loadCatalog();
        const { venues, cats, tags } = matchCatalog(catalog, trimmed, 6);
        if (venues.length && (cats.size || tags.size || venues.length >= 3)) {
          localRecs = venuesToRecs(venues, lang);
        }
      } catch { /* bundled catalog unavailable — fall through to the typing indicator */ }
      if (localRecs.length) {
        setMessages((prev) => [...prev, { role: 'assistant', content: strs.preview, recommendations: localRecs, provisional: true }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '__typing__' }]);
      }

      const clearTransient = (list: Message[]) => list.filter((m) => m.content !== '__typing__' && !m.provisional);

      try {
        const token = Platform.OS === 'web'
          ? await AsyncStorage.getItem('session_token')
          : await SecureStore.getItemAsync('session_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        // Bound the wait: a slow Sonnet turn (or a 5xx) falls back to the instant local
        // venues below instead of hanging or dead-erroring.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 14000);
        let apiRes: Response;
        try {
          apiRes = await fetch(CONCIERGE_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: trimmed,
              session_id: sessionId,
              screen_context: pathname,
              language: lang,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(timer); }
        if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);
        const res = await apiRes.json();
        const sid: string = res.session_id;
        if (sid && sid !== sessionId) {
          setSessionId(sid);
          persistSession(sid);
        }
        const a = res.assistant;
        setMessages((prev) => [
          ...clearTransient(prev),
          {
            role: 'assistant',
            content: a.content,
            actions: a.actions || [],
            recommendations: enrichRecommendations(a.recommendations || [], catalog),
            suggestions: a.suggestions || [],
            language: a.language,
          },
        ]);
      } catch {
        // Luna slow / errored / timed out → keep the guest moving with REAL venues,
        // never a dead "Tuve un problema".
        setMessages((prev) => {
          const next = clearTransient(prev);
          if (localRecs.length) {
            return [...next, { role: 'assistant', content: strs.slow, recommendations: localRecs }];
          }
          return [...next, { role: 'assistant', content: strs.nohit }];
        });
      }
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    },
    [sending, sessionId, persistSession, pathname, user, lang, guestExchangeCount],
  );

  const onAction = useCallback(
    (a: Action) => {
      switch (a.type) {
        case 'navigate': {
          if (!a.screen) return;
          if (a.screen === 'login') {
            // Drop GATE's own pattern (SignupGateContext.proceed / login.tsx's
            // `next` param), mirrored here: preserve return context so signup
            // drops the guest back where they were — never a dead-end bare
            // /login. safeNext() also guards pathname's route-group syntax
            // (e.g. parens), falling back to the tabs root exactly like
            // login.tsx's own no-dest branch already does.
            const dest = safeNext(pathname) || '/(tabs)';
            try {
              if (Platform.OS === 'web') {
                sessionStorage.setItem(STORAGE_REOPEN_KEY, '1');
              } else {
                AsyncStorage.setItem(STORAGE_REOPEN_KEY, '1').catch(() => {});
              }
            } catch { /* reopen-hint persist failed — sheet just won't auto-reopen on return */ }
            setOpen(false);
            router.push({ pathname: '/login' as any, params: { next: dest } });
            return;
          }
          const map: Record<string, string> = {
            agenda: '/(tabs)/agenda',
            concerts: '/(tabs)/agenda',
            partners: '/(tabs)/partners',
            citypass: '/(tabs)/citypass',
            transport: '/transport',
            itineraries: '/itineraries',
            search: '/search',
          };
          const p = map[a.screen];
          if (p) {
            setOpen(false);
            router.push(p as any);
          }
          return;
        }
        case 'show_partners': {
          setOpen(false);
          router.push({ pathname: '/(tabs)/partners' as any, params: a.filters || {} });
          return;
        }
        case 'show_events': {
          setOpen(false);
          router.push({ pathname: '/(tabs)/agenda' as any, params: a.filters || {} });
          return;
        }
        case 'open_partner': {
          if (!a.partner_id) return;
          setOpen(false);
          router.push({ pathname: '/partner/[id]' as any, params: { id: a.partner_id } });
          return;
        }
        case 'open_event': {
          if (!a.event_id) return;
          setOpen(false);
          // Partner-published events (pe_*) live on their own detail screen;
          // /event/[id] only resolves editorial events-collection ids.
          const eventPath = String(a.event_id).startsWith('pe_') ? '/partner-event/[id]' : '/event/[id]';
          router.push({ pathname: eventPath as any, params: { id: a.event_id } });
          return;
        }
        case 'open_port_tax_checkout': {
          setOpen(false);
          const params: Record<string, string> = {};
          if (a.qty) params.qty = String(a.qty);
          if (a.travel_date) params.travel_date = a.travel_date;
          router.push({ pathname: '/port-tax/checkout' as any, params });
          return;
        }
        case 'open_city_pass': {
          setOpen(false);
          const params: Record<string, string> = {};
          if (a.plan_id) params.plan_id = a.plan_id;
          router.push({ pathname: '/(tabs)/citypass' as any, params });
          return;
        }
        case 'reservation_link': {
          if (!a.partner_id) return;
          setOpen(false);
          router.push({ pathname: '/partner/[id]' as any, params: { id: a.partner_id } });
          return;
        }
        case 'show_itinerary': {
          setOpen(false);
          const params: Record<string, string> = {};
          if (a.category) params.category = a.category;
          router.push({ pathname: '/itineraries' as any, params });
          return;
        }
        case 'external_link': {
          if (!a.url) return;
          if (Platform.OS === 'web') window.open(a.url, '_blank');
          // For native, we'd use Linking.openURL — skipping to keep dep light
          return;
        }
      }
    },
    [router, pathname],
  );

  const newChat = useCallback(async () => {
    setMessages([]);
    setSessionId(null);
    setInput('');
    persistSession('');
  }, [persistSession]);

  return (
    <>
      {/* Floating Action Button — hidden when hideFab=true (e.g. on home tab where the search bar handles it) */}
      {!hideFab ? (
        <View style={styles.fab} pointerEvents="box-none">
          <Animated.View
            pointerEvents="none"
            style={[styles.fabHalo, { opacity: reducedMotion ? 0 : halo.opacity, transform: [{ scale: halo.scale }] }]}
          />
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <TouchableOpacity
              accessibilityLabel={FAB_A11Y[lang] || FAB_A11Y.es}
              activeOpacity={0.85}
              onPress={() => setOpen(true)}
              style={styles.fabBtn}
            >
              <View style={styles.fabGradientClip}>
                <LinearGradient colors={LUNA_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
              </View>
              <View style={styles.fabBadge}>
                <Text style={styles.fabBadgeText}>AI</Text>
              </View>
              <Ionicons name="sparkles" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : null}

      {/* Chat Modal */}
      <Modal
        visible={open}
        animationType={reducedMotion ? 'none' : 'slide'}
        transparent={false}
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.modalWrap} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <LunaAvatar size={36} />
              <View>
                <Text style={styles.headerTitle}>Luna</Text>
                <Text style={styles.headerSub}>{s('assistant_subtitle')}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={newChat} style={styles.headerBtn}>
                <Ionicons name="create-outline" size={20} color={COLORS.icon} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.headerBtn}>
                <Ionicons name="close" size={22} color={COLORS.textMain} />
              </TouchableOpacity>
            </View>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: 30 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m, idx) =>
                m.isWelcome && messages.length === 1 ? (
                  <WelcomeHero key={idx} greeting={m.content} lang={lang} onPick={send} />
                ) : (
                  <MessageBubble key={idx} m={m} onAction={onAction} onSuggestion={send} lang={lang} reducedMotion={reducedMotion} />
                ),
              )}
            </ScrollView>

            <View style={styles.inputBar}>
              <TextInput
                placeholder={s('assistant_placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={input}
                onChangeText={setInput}
                style={[styles.input, inputFocused && styles.inputFocused]}
                multiline
                maxLength={500}
                editable={!sending}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                blurOnSubmit
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
                onPress={() => send(input)}
                disabled={!input.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={COLORS.white} />
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

// First-open hero: Luna's greeting + a showcase of what she can do. Replaces
// the plain bubble+pills treatment ONLY while it's the sole message in the
// thread — once the guest sends anything, normal MessageBubble rendering takes
// over for every turn (including Luna's own dynamic `suggestions` pills, which
// are a completely separate, backend-driven mechanism from these prompts).
function WelcomeHero({
  greeting,
  lang,
  onPick,
}: {
  greeting: string;
  lang: Lang;
  onPick: (text: string) => void;
}) {
  const prompts = QUICK_PROMPTS[lang] || QUICK_PROMPTS.es;
  return (
    <View style={styles.welcomeHero}>
      <LunaAvatar size={52} />
      <Text style={styles.welcomeGreeting}>{greeting}</Text>
      <View style={styles.quickPromptsWrap}>
        {prompts.map((qp, i) => (
          <Pressable
            key={i}
            onPress={() => onPick(qp.text)}
            style={({ pressed }) => [
              styles.quickPromptChip,
              pressed && { opacity: 0.75 },
              Platform.OS === 'web' && ({ touchAction: 'manipulation', cursor: 'pointer' } as any),
            ]}
          >
            <Ionicons name={qp.icon} size={15} color={LUNA_ACCENT} />
            <Text style={styles.quickPromptText} numberOfLines={2}>{qp.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MessageBubble({
  m,
  onAction,
  onSuggestion,
  lang,
  reducedMotion,
}: {
  m: Message;
  onAction: (a: Action) => void;
  onSuggestion: (text: string) => void;
  lang: Lang;
  reducedMotion: boolean;
}) {
  if (m.role === 'user') {
    return (
      <View style={[styles.bubble, styles.bubbleUser]}>
        <Text style={styles.bubbleUserText}>{m.content}</Text>
      </View>
    );
  }
  if (m.content === '__typing__') {
    return (
      <View style={styles.assistRow}>
        <LunaAvatar size={22} />
        <View style={[styles.bubble, styles.bubbleAssist]}>
          <TypingDots reduced={reducedMotion} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.assistRow}>
      <LunaAvatar size={22} />
      <View style={{ flex: 1, alignItems: 'flex-start', gap: 8 }}>
        <View style={[styles.bubble, styles.bubbleAssist]}>
          <Text style={styles.bubbleAssistText}>{renderBold(m.content)}</Text>
        </View>
        {!!(m.recommendations && m.recommendations.length) && (
          // Web: a plain CSS scroller — RNW ScrollView's JS touch responder
          // swallows horizontal swipes inside the chat modal on iOS Safari.
          Platform.OS === 'web' ? (
            <View
              style={[styles.recsScroll, styles.recsScrollContent, {
                flexDirection: 'row',
                overflowX: 'auto',
                overflowY: 'hidden',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-x',
                maxWidth: '100%',
              } as any]}
            >
              {m.recommendations.map((r, i) => (
                <RecommendationCard
                  key={`rec-${i}-${r.partner_id || r.event_id}`}
                  rec={r}
                  lang={lang}
                  onPress={() =>
                    onAction(
                      r.kind === 'event'
                        ? { type: 'open_event', event_id: r.event_id }
                        : { type: 'open_partner', partner_id: r.partner_id },
                    )
                  }
                />
              ))}
            </View>
          ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={styles.recsScrollContent}
            style={styles.recsScroll}
          >
            {m.recommendations.map((r, i) => (
              <RecommendationCard
                key={`rec-${i}-${r.partner_id || r.event_id}`}
                rec={r}
                lang={lang}
                onPress={() =>
                  onAction(
                    r.kind === 'event'
                      ? { type: 'open_event', event_id: r.event_id }
                      : { type: 'open_partner', partner_id: r.partner_id },
                  )
                }
              />
            ))}
          </ScrollView>
          )
        )}
        {!!(m.actions && m.actions.length) && (
          <View style={styles.actionsWrap}>
            {m.actions.map((a, i) => (
              <Pressable key={i} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }, Platform.OS === 'web' && ({ touchAction: 'manipulation', cursor: 'pointer' } as any)]} onPress={() => onAction(a)}>
                <Ionicons name={iconForAction(a.type)} size={13} color={COLORS.primary} />
                <Text style={styles.actionBtnText} numberOfLines={1}>
                  {a.label || defaultLabel(a, lang)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!(m.suggestions && m.suggestions.length) && (
          <View style={styles.actionsWrap}>
            {m.suggestions.slice(0, 4).map((sugg, i) => (
              <Pressable key={i} style={({ pressed }) => [styles.suggestionPill, pressed && { opacity: 0.8 }]} onPress={() => onSuggestion(sugg)}>
                <Text style={styles.suggestionText}>{sugg}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// Model output occasionally carries **bold** despite the no-markdown rule —
// render it as real bold, never raw asterisks.
function renderBold(text: string): React.ReactNode {
  const parts = String(text || '').split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text> : p));
}

function RecommendationCard({
  rec,
  lang,
  onPress,
}: {
  rec: Recommendation;
  lang: Lang;
  onPress: () => void;
}) {
  const isEvent = rec.kind === 'event';
  // Every venue keeps ITS OWN spectrum color (never Luna's purple) — category
  // when we have it (catalog-resolved), else the human `type` label, else a
  // stable generic fallback. colorForKey() hashes anything unrecognized into a
  // distinct, stable color, so a card is never monochrome.
  const accent = colorForKey(rec.category || rec.type || (isEvent ? 'event' : 'partner'));
  const icon: keyof typeof Ionicons.glyphMap = isEvent ? 'calendar' : 'business';
  const L = RECOMMENDATION_LABELS[lang] || RECOMMENDATION_LABELS.es;
  const chipLabel = rec.type || (isEvent ? L.event : L.partner);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recCardShadow, pressed && { opacity: 0.88 }, Platform.OS === 'web' && ({ touchAction: 'manipulation', cursor: 'pointer' } as any)]}
    >
      <View style={styles.recCardInner}>
        {rec.image ? (
          <View style={styles.recImageWrap}>
            <SafeImage uri={rec.image} category={rec.category} style={styles.recImage} resizeMode="cover" />
            <View style={[styles.recImageBar, { backgroundColor: accent }]} />
            {!!rec.price_range && (
              <View style={[styles.recPriceBadge, styles.recPriceBadgeOnPhoto]}>
                <Text style={styles.recPriceText}>{rec.price_range}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.recIconHeader, { backgroundColor: accent + '1F' }]}>
            <View style={[styles.recIcon, { backgroundColor: accent }]}>
              <Ionicons name={icon} size={16} color={COLORS.white} />
            </View>
            {!!rec.price_range && (
              <View style={[styles.recPriceBadge, styles.recPriceBadgeOnDark]}>
                <Text style={styles.recPriceText}>{rec.price_range}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.recMetaRow}>
          <View style={[styles.recKindChip, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
            <Text style={[styles.recKindChipText, { color: accent }]} numberOfLines={1}>{chipLabel}</Text>
          </View>
          {/* Drop 10 (10D1): Luna recommends INTO the itinerary — one tap adds */}
          {rec.kind === 'partner' && rec.partner_id ? (
            <AddToTrip refType="venue" refId={rec.partner_id} name={rec.name} compact />
          ) : rec.kind === 'event' && rec.event_id && String(rec.event_id).startsWith('pe_') ? (
            <AddToTrip refType="experience" refId={rec.event_id} name={rec.name} compact />
          ) : null}
        </View>

        <View style={styles.recBody}>
          <Text style={styles.recName} numberOfLines={2}>
            {rec.name}
          </Text>
          {!!rec.vibe && (
            <View style={styles.recVibeRow}>
              <Ionicons name="sparkles" size={11} color={COLORS.icon} />
              <Text style={styles.recVibe} numberOfLines={2}>
                {rec.vibe}
              </Text>
            </View>
          )}
          {!!rec.reason && (
            <Text style={styles.recReason} numberOfLines={3}>
              {rec.reason}
            </Text>
          )}
          {!!rec.address && (
            <View style={styles.recVibeRow}>
              <Ionicons name="location-outline" size={11} color={COLORS.icon} />
              <Text style={styles.recVibe} numberOfLines={1}>
                {rec.address}
              </Text>
            </View>
          )}
          <View style={[styles.recCta, { backgroundColor: accent }]}>
            <Text style={styles.recCtaText}>
              {isEvent ? L.viewEvent : L.viewPartner}
            </Text>
            <Ionicons name="arrow-forward" size={13} color={COLORS.white} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function TypingDots({ reduced }: { reduced: boolean }) {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      a1.setValue(0.6);
      a2.setValue(0.6);
      a3.setValue(0.6);
      return;
    }
    const seq = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
      );
    const anims = [seq(a1, 0), seq(a2, 150), seq(a3, 300)];
    anims.forEach((anim) => anim.start());
    return () => anims.forEach((anim) => anim.stop());
  }, [a1, a2, a3, reduced]);
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 4 }}>
      {[a1, a2, a3].map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: LUNA_ACCENT,
            opacity: v,
          }}
        />
      ))}
    </View>
  );
}

function iconForAction(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'navigate':
      return 'arrow-forward-circle';
    case 'show_partners':
      return 'restaurant';
    case 'show_events':
    case 'open_event':
      return 'calendar';
    case 'open_partner':
    case 'reservation_link':
      return 'business';
    case 'open_port_tax_checkout':
      return 'boat';
    case 'open_city_pass':
      return 'key';
    case 'show_itinerary':
      return 'map';
    case 'external_link':
      return 'open-outline';
    default:
      return 'sparkles';
  }
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 95 : 90,
    zIndex: 999,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabHalo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: LUNA_ACCENT,
  },
  fabBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LUNA_ACCENT,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  fabGradientClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    overflow: 'hidden',
  },
  fabBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#22C55E',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    zIndex: 2,
  },
  fabBadgeText: { color: COLORS.white, fontSize: 9, ...FONTS.bold, letterSpacing: 0.3 },
  modalWrap: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lunaAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LUNA_ACCENT,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  headerTitle: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold },
  headerSub: { color: COLORS.textMuted, fontSize: 10, ...FONTS.regular, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: SPACING.xs },
  headerBtn: { padding: 6 },

  // ── Welcome hero (first open) ──
  welcomeHero: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    gap: SPACING.sm,
  },
  welcomeGreeting: {
    color: COLORS.textMain,
    fontSize: 15,
    ...FONTS.regular,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: SPACING.sm,
  },
  quickPromptsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: SPACING.xs,
  },
  quickPromptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '46%',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
    backgroundColor: LUNA_TINT,
    borderWidth: 1,
    borderColor: LUNA_TINT_BORDER,
  },
  quickPromptText: { color: COLORS.textMain, fontSize: 12, ...FONTS.medium, flexShrink: 1 },

  // ── Bubbles ──
  assistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bubble: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleUserText: { color: COLORS.textMain, fontSize: 14, ...FONTS.regular, lineHeight: 19 },
  bubbleAssist: {
    backgroundColor: LUNA_TINT,
    borderWidth: 1,
    borderColor: LUNA_TINT_BORDER,
    borderBottomLeftRadius: 4,
  },
  bubbleAssistText: { color: COLORS.textMain, fontSize: 14, ...FONTS.regular, lineHeight: 19 },

  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '90%' },

  recsScroll: { marginLeft: -SPACING.md, marginRight: -SPACING.md },
  recsScrollContent: { paddingHorizontal: SPACING.md, gap: 10 },
  recCardShadow: {
    width: 240,
    flexShrink: 0,
    marginRight: 10,
    borderRadius: RADIUS.lg,
    ...ELEVATION.card,
  },
  recCardInner: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    overflow: 'hidden',
  },
  recImageWrap: { width: '100%', height: 100, position: 'relative' },
  recImage: { width: '100%', height: 100 },
  recImageBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  recIconHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  recIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recPriceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  recPriceBadgeOnDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: COLORS.hairline },
  recPriceBadgeOnPhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(8,12,22,0.72)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  recPriceText: { color: COLORS.white, fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  recMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 6,
  },
  recKindChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    flexShrink: 1,
  },
  recKindChipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.2 },
  recBody: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 6, gap: 5 },
  recName: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold, lineHeight: 18 },
  recVibeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recVibe: { color: COLORS.textMuted, fontSize: 11, ...FONTS.regular, flex: 1 },
  recReason: {
    color: COLORS.textMain,
    fontSize: 11.5,
    ...FONTS.regular,
    lineHeight: 15,
    marginTop: 3,
    opacity: 0.92,
  },
  recCta: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
  },
  recCtaText: { color: COLORS.white, fontSize: 12, ...FONTS.bold },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(18,181,165,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(18,181,165,0.4)',
  },
  actionBtnText: { color: COLORS.primary, fontSize: 11.5, ...FONTS.bold, maxWidth: 200 },

  suggestionPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  suggestionText: { color: COLORS.textMain, fontSize: 11.5, ...FONTS.medium },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.md : SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textMain,
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputFocused: {
    borderColor: LUNA_ACCENT,
    shadowColor: LUNA_ACCENT,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
