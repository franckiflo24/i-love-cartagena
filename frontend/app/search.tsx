import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, ActivityIndicator, Keyboard, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';
import { useLang } from '../src/context/LanguageContext';
import { SafeImage } from '../src/components/SafeImage';

type AIHighlight = { type: string; id: string; reason: string };
type AIRecommendation = {
  kind: 'partner' | 'event';
  partner_id?: string;
  event_id?: string;
  name: string;
  type?: string;
  vibe?: string;
  price_range?: string;
  address?: string;
  reason?: string;
};
type AIAction = {
  type: string;
  label?: string;
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
type AIPayload = {
  query: string;
  intent: string;
  answer: string;
  language?: string;
  suggested_tab?: string;
  highlights: AIHighlight[];
  recommendations?: AIRecommendation[];
  actions?: AIAction[];
  suggestions?: string[];
};

type Results = {
  events: any[];
  concerts: any[];
  partners: any[];
  venues: any[];
  transport: any[];
  partner_events: any[];
  ai?: AIPayload;
  search_id?: string;
};

const INTENT_META: Record<string, { color: string; icon: string; label: string }> = {
  partner:    { color: '#A855F7', icon: 'business',          label: 'Partner' },
  event:      { color: '#22C55E', icon: 'calendar',          label: 'Evento' },
  concert:    { color: '#F472B6', icon: 'musical-notes',     label: 'Concierto' },
  transport:  { color: '#3B82F6', icon: 'boat',              label: 'Transporte' },
  itinerary:  { color: '#FBBF24', icon: 'map',               label: 'Itinerario' },
  city_pass:  { color: '#D97706', icon: 'sparkles',          label: 'City Pass' },
  port_tax:   { color: '#06B6D4', icon: 'qr-code',           label: 'Tasa Portuaria' },
  general:    { color: COLORS.primary, icon: 'compass',      label: 'Sugerencia' },
};

const TAB_TO_ROUTE: Record<string, string> = {
  'Agenda':     '/(tabs)/agenda',
  'Conciertos': '/concerts',
  'Partners':   '/(tabs)/partners',
  'City Pass':  '/(tabs)/citypass',
  'Transporte': '/transport',
};

// Voice transcription via Web Speech API
// Supports language switching — user can tap to toggle between ES/EN while listening
function useVoiceInput(onTranscript: (text: string) => void, onFinal: (text: string) => void, appLang: string) {
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState(appLang === 'en' ? 'en' : 'es');
  const recognitionRef = React.useRef<any>(null);
  const mountedRef = React.useRef(true);

  const onTranscriptRef = React.useRef(onTranscript);
  const onFinalRef = React.useRef(onFinal);
  onTranscriptRef.current = onTranscript;
  onFinalRef.current = onFinal;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_e) { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleVoiceLang = useCallback(() => {
    const next = voiceLang === 'es' ? 'en' : 'es';
    setVoiceLang(next);
    // If currently listening, restart with new language
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_e) { /* ignore */ }
      recognitionRef.current = null;
      // Small delay then restart
      setTimeout(() => startWithLang(next), 200);
    }
  }, [voiceLang]);

  const startWithLang = useCallback((useLang: string) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_e) { /* ignore */ }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    // Use specific locale codes for best accuracy
    const langMap: Record<string, string> = {
      'es': 'es-419',   // Latin American Spanish (covers Colombian accent)
      'en': 'en-US',    // American English (most tourists)
      'fr': 'fr-FR',
      'pt': 'pt-BR',
    };
    recognition.lang = langMap[useLang] || 'es-419';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      if (mountedRef.current) setListening(true);
    };

    recognition.onend = () => {
      if (mountedRef.current) setListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (e: any) => {
      // 'no-speech' and 'aborted' are not real errors — just stop gracefully
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('[useVoiceInput] SpeechRecognition error:', e.error);
      }
      if (mountedRef.current) setListening(false);
      recognitionRef.current = null;
    };

    recognition.onresult = (event: any) => {
      if (!mountedRef.current) return;
      let fullTranscript = '';
      let hasFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        // Use the highest-confidence alternative
        const best = result[0]?.transcript || '';
        fullTranscript += best;
        if (result.isFinal) hasFinal = true;
      }
      // Always show what we've got so far
      if (fullTranscript) {
        onTranscriptRef.current(fullTranscript.trim());
      }
      // When we have a final result, stop listening and trigger search
      if (hasFinal && fullTranscript.trim().length >= 2) {
        try { recognition.stop(); } catch (_e) { /* ignore */ }
        onFinalRef.current(fullTranscript.trim());
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error('[useVoiceInput] Failed to start:', e);
      if (mountedRef.current) setListening(false);
      recognitionRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    startWithLang(voiceLang);
  }, [voiceLang, startWithLang]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_e) { /* ignore */ }
      recognitionRef.current = null;
    }
    if (mountedRef.current) setListening(false);
  }, []);

  return { listening, startListening, stopListening, voiceLang, toggleVoiceLang };

}

export default function SearchScreen() {
  const tr = useTr();
  const router = useRouter();
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearchRef = React.useRef<((q: string) => void) | null>(null);

  // Voice input — live transcript updates the input, final transcript triggers search
  const handleVoiceTranscript = useCallback((text: string) => {
    setQuery(text);
  }, []);

  const handleVoiceFinal = useCallback((text: string) => {
    setQuery(text);
    // Auto-search after a short delay to let the UI update
    if (text.length >= 3) {
      setTimeout(() => doSearchRef.current?.(text), 400);
    }
  }, []);

  const { listening, startListening, stopListening, voiceLang, toggleVoiceLang } = useVoiceInput(handleVoiceTranscript, handleVoiceFinal, lang || 'es');

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      // Try backend search first
      let data: any = null;
      try {
        data = await api.get(`/search?q=${encodeURIComponent(q)}&lang=${lang || 'es'}`);
      } catch { /* backend failed, will use static fallback */ }

      // Check if backend returned real results (partners, events, OR AI)
      const hasPartners = data && Array.isArray(data.partners) && data.partners.length > 0;
      const hasEvents = data && Array.isArray(data.events) && data.events.length > 0;
      const hasConcerts = data && Array.isArray(data.concerts) && data.concerts.length > 0;
      const hasAI = data && data.ai && (data.ai.answer || (data.ai.recommendations && data.ai.recommendations.length > 0));
      const hasResults = hasPartners || hasEvents || hasConcerts;

      // If backend returned AI + no partner results, run client-side search
      // but with smart matching. If backend returned nothing at all, also fallback.
      if (!hasResults) {
        const norm = (s: any): string => (typeof s === 'string' ? s : '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Stop words: never search for these alone
        const STOP_WORDS = new Set([
          'a', 'al', 'con', 'de', 'del', 'el', 'en', 'es', 'la', 'las',
          'lo', 'los', 'me', 'mi', 'no', 'por', 'que', 'se', 'si', 'su',
          'te', 'tu', 'un', 'una', 'y', 'o', 'to', 'the', 'in', 'is',
          'it', 'of', 'on', 'for', 'my', 'an', 'at', 'do', 'im', 'i',
          // Address words that would otherwise count as distinctive signal
          'san', 'santa', 'santo', 'calle', 'carrera', 'avenida',
        ]);

        const queryTerms = norm(q).split(/\s+/).filter(w => w.length >= 3 || !STOP_WORDS.has(w));
        // Remove remaining stop words of any length
        const meaningfulTerms = queryTerms.filter(w => w.length >= 3 && !STOP_WORDS.has(w));

        // Synonym expansion: map common queries to categories and Spanish terms
        const SYNONYMS: Record<string, string[]> = {
          'cena': ['restaurant', 'restaurante', 'comida', 'gastronomia'],
          'romantica': ['restaurant', 'restaurante', 'bistro', 'italiano', 'frances'],
          'romantic': ['restaurant', 'restaurante', 'bistro'],
          'dinner': ['restaurant', 'restaurante', 'comida', 'cena'],
          'lunch': ['restaurant', 'restaurante', 'brunch', 'almuerzo'],
          'breakfast': ['restaurant', 'cafe', 'brunch', 'desayuno'],
          'eat': ['restaurant', 'restaurante', 'comida'],
          'food': ['restaurant', 'restaurante', 'comida'],
          'drinks': ['bar', 'cocktail', 'rooftop', 'coctel'],
          'cocktails': ['bar', 'cocktail', 'rooftop'],
          'dance': ['club', 'salsa', 'nightlife', 'discoteca', 'champeta'],
          'beach': ['beach_club', 'playa', 'isla', 'baru'],
          'playa': ['beach_club', 'playa', 'isla', 'baru'],
          'pool': ['beach_club', 'hotel', 'piscina'],
          'music': ['concert', 'concierto', 'festival', 'musica'],
          'concierto': ['concert', 'musica', 'festival'],
          'conciertos': ['concert', 'musica', 'festival'],
          'relax': ['spa', 'wellness', 'yoga', 'masaje'],
          'massage': ['spa', 'masaje', 'wellness'],
          'masaje': ['spa', 'masaje', 'wellness'],
          'hair': ['beauty', 'salon', 'peluqueria', 'barberia'],
          'nails': ['beauty', 'unas', 'manicure'],
          'nightlife': ['club', 'bar', 'nightlife', 'discoteca', 'rooftop'],
          'fiesta': ['club', 'party', 'nightlife', 'festival'],
          'party': ['club', 'party', 'nightlife', 'beach_club'],
          'lancha': ['yacht', 'boat', 'barco', 'bote', 'paseo', 'isla'],
          'barco': ['yacht', 'boat', 'lancha', 'paseo', 'isla'],
          'boat': ['yacht', 'boat', 'lancha', 'barco', 'isla'],
          'yacht': ['yacht', 'boat', 'lancha', 'barco'],
          'rosario': ['rosario', 'isla', 'islas', 'snorkel', 'buceo'],
          'baru': ['baru', 'playa', 'beach', 'isla'],
          'isla': ['isla', 'rosario', 'baru', 'yacht', 'boat'],
          'dive': ['buceo', 'diving', 'snorkel', 'submarino'],
          'buceo': ['buceo', 'diving', 'snorkel', 'dive'],
          'tour': ['tour', 'cultural', 'recorrido', 'paseo', 'guia'],
          'gym': ['fitness', 'gym', 'gimnasio', 'crossfit', 'sport'],
          'gimnasio': ['fitness', 'gym', 'gimnasio', 'crossfit'],
          'yoga': ['yoga', 'wellness', 'meditacion', 'pilates'],
          'cafe': ['cafe', 'coffee', 'brunch', 'desayuno'],
          'coffee': ['cafe', 'coffee', 'brunch'],
          'hotel': ['hotel', 'hostel', 'hospedaje', 'alojamiento'],
          'spa': ['spa', 'masaje', 'wellness', 'relajacion'],
          'kids': ['familia', 'ninos', 'infantil', 'family'],
          'ninos': ['familia', 'ninos', 'infantil', 'kids'],
          'safe': ['seguridad', 'seguro', 'emergencia'],
          'cambio': ['currency_exchange', 'cambio', 'divisa', 'dolar'],
          'money': ['currency_exchange', 'cambio', 'divisa', 'banco'],
          'farmacia': ['pharmacy', 'farmacia', 'drogueria'],
          'tattoo': ['tattoo', 'tatuaje'],
          'tatuaje': ['tattoo', 'tatuaje'],
          // Cuisines — mapped to the real partner taxonomy (subcategory/cuisine values)
          'thai': ['thai', 'tailandesa', 'asian', 'asiatica'],
          'tailandes': ['thai', 'asian'], 'tailandesa': ['thai', 'asian'],
          'sushi': ['sushi', 'japones', 'japonesa', 'nikkei', 'asian', 'asiatica'],
          'japones': ['sushi', 'japonesa', 'asian'], 'japonesa': ['sushi', 'asian'],
          'asiatico': ['asian', 'asiatica'], 'asiatica': ['asian'], 'asian': ['asiatica'],
          'chino': ['asian', 'asiatica', 'china'], 'ramen': ['asian', 'asiatica', 'japonesa'],
          'italiano': ['italiana', 'italian', 'pasta', 'pizza'],
          'italiana': ['italian', 'pasta', 'pizza'], 'italian': ['italiana'],
          'pizza': ['italiana', 'italian', 'pizzeria'], 'pasta': ['italiana', 'italian'],
          'frances': ['francesa', 'bistro'], 'francesa': ['bistro'],
          'espanol': ['espanola', 'tapas', 'paella'], 'espanola': ['tapas'],
          'tapas': ['espanola'], 'paella': ['espanola'],
          'vegano': ['vegetarian', 'vegetariano', 'vegan', 'saludable'],
          'vegana': ['vegetarian', 'vegan'], 'vegan': ['vegetarian'],
          'vegetariano': ['vegetarian'], 'vegetariana': ['vegetarian'],
          'mariscos': ['seafood', 'pescado', 'ceviche'], 'seafood': ['mariscos', 'pescado'],
          'pescado': ['seafood', 'mariscos'], 'ceviche': ['seafood', 'cevicheria', 'peruana'],
          'mexicano': ['mexicana', 'tacos'], 'mexicana': ['tacos'], 'tacos': ['mexicana'],
          'peruano': ['peruana', 'ceviche', 'nikkei'], 'peruana': ['ceviche', 'nikkei'],
          'arabe': ['libanesa', 'shawarma'], 'shawarma': ['arabe'], 'libanes': ['arabe'],
          'carnes': ['parrilla', 'steak', 'steakhouse'], 'steak': ['carnes', 'parrilla'],
          'parrilla': ['carnes', 'steak'], 'asado': ['carnes', 'parrilla'],
          'colombiano': ['colombian', 'caribena', 'tipica'], 'colombiana': ['colombian', 'caribena'],
          'caribeno': ['caribena', 'colombian'], 'caribena': ['colombian'],
          'burger': ['fastfood', 'hamburguesa'], 'hamburguesa': ['fastfood', 'burger'],
          'hamburguesas': ['fastfood', 'burger'],
          'argentino': ['argentina', 'parrilla', 'carnes'], 'argentina': ['parrilla'],
          'mediterraneo': ['mediterranean'], 'mediterranea': ['mediterranean'],
          'brunch': ['cafe', 'desayuno'], 'desayuno': ['cafe', 'brunch'],
          'postre': ['cafe', 'reposteria', 'helado'], 'helado': ['gelato', 'heladeria'],
        };

        // Term classes — generic words qualify a search, they don't define it.
        // "restaurant thai centro": 'thai' is the signal, 'restaurant' narrows
        // category, 'centro' expresses location. Weighting them equally buries
        // the one Thai restaurant under 200 partners that say "restaurante".
        const GENERIC_TERMS = new Set([
          'restaurant', 'restaurante', 'restaurantes', 'comida', 'food',
          'hotel', 'hoteles', 'bar', 'bares', 'cafe', 'club', 'spa',
          'lugar', 'lugares', 'sitio', 'sitios', 'place', 'places',
          'mejor', 'mejores', 'best', 'bueno', 'buena', 'good',
          'donde', 'where', 'cerca', 'near', 'abierto', 'open',
        ]);
        const NEIGHBORHOOD_PATTERNS: Record<string, string[]> = {
          'centro': ['centro', 'ciudad amurallada', 'walled city'],
          'getsemani': ['getsemani'],
          'bocagrande': ['bocagrande'],
          'manga': ['manga'],
          'crespo': ['crespo'],
          'castillogrande': ['castillogrande'],
          'laguito': ['laguito'],
          'matuna': ['matuna'],
          'diego': ['san diego'],
          'popa': ['pie de la popa'],
          'baru': ['baru'],
        };

        // Partition terms by class, then expand with synonyms. Original
        // distinctive terms weigh 1.0, their synonym expansions 0.7 (so an
        // exact 'thai' hit outranks an 'asian' taxonomy hit), generic terms 0.3.
        const neighborhoodTerms = meaningfulTerms.filter(t => NEIGHBORHOOD_PATTERNS[t]);
        const genericTerms = meaningfulTerms.filter(t => !NEIGHBORHOOD_PATTERNS[t] && GENERIC_TERMS.has(t));
        const distinctiveTerms = meaningfulTerms.filter(t => !NEIGHBORHOOD_PATTERNS[t] && !GENERIC_TERMS.has(t));

        const termWeights = new Map<string, number>();
        const distinctiveSet = new Set<string>();
        for (const t of distinctiveTerms) {
          termWeights.set(t, 1);
          distinctiveSet.add(t);
          for (const syn of (SYNONYMS[t] || [])) {
            const s = norm(syn);
            if (!termWeights.has(s)) termWeights.set(s, 0.7);
            distinctiveSet.add(s);
          }
        }
        for (const t of genericTerms) {
          if (!termWeights.has(t)) termWeights.set(t, 0.3);
          for (const syn of (SYNONYMS[t] || [])) {
            const s = norm(syn);
            if (!termWeights.has(s)) termWeights.set(s, 0.3);
          }
        }
        const terms = Array.from(termWeights.keys());
        const neighborhoodMatchers = neighborhoodTerms.flatMap(t => NEIGHBORHOOD_PATTERNS[t]);

        // Score-based matching: weight by field importance AND term class.
        // A partner must hit at least one distinctive term (when any exist)
        // to appear at all — generic/location words alone don't qualify it.
        const scorePartner = (p: any): { score: number; hasDistinctive: boolean } => {
          let score = 0;
          let hasDistinctive = false;
          const fields = [
            { val: p.name, weight: 3 },
            { val: p.cuisine, weight: 3 },
            { val: p.category, weight: 2 },
            { val: p.subcategory, weight: 2 },
            { val: p.experience, weight: 2 },
            { val: p.description, weight: 1 },
            { val: p.address, weight: 1 },
          ];
          for (const t of terms) {
            const tw = termWeights.get(t) || 0;
            let termHit = false;
            for (const f of fields) {
              const fNorm = norm(f.val);
              if (!fNorm) continue;
              // Full word match scores higher than substring
              const wordMatch = fNorm.split(/\s+/).some((w: string) => w === t || w.startsWith(t));
              if (wordMatch) {
                score += f.weight * 2 * tw;
                termHit = true;
              } else if (fNorm.includes(t) && t.length >= 4) {
                // Only allow substring matches for terms 4+ chars (avoids "la" matching "playa")
                score += f.weight * tw;
                termHit = true;
              }
            }
            if (termHit && distinctiveSet.has(t)) hasDistinctive = true;
          }
          // Location is a boost, not a filter: "thai centro" with zero Thai in
          // Centro should still surface the Getsemaní one, ranked honestly.
          if (neighborhoodMatchers.length) {
            const addr = norm(p.address);
            if (neighborhoodMatchers.some(nb => addr.includes(nb))) score += 5;
          }
          return { score, hasDistinctive };
        };

        const [allPartners, allEvents, allConcerts] = await Promise.all([
          fetch('/data/partners.json').then(r => r.json()).catch(() => []),
          fetch('/data/events.json').then(r => r.json()).catch(() => []),
          fetch('/data/concerts.json').then(r => r.json()).catch(() => []),
        ]);

        const minScore = distinctiveTerms.length > 0 ? 3 : 1.5;
        const scored = (Array.isArray(allPartners) ? allPartners : [])
          .map((p: any) => { const r = scorePartner(p); return { ...p, _score: r.score, _hasDistinctive: r.hasDistinctive }; })
          .filter((p: any) => p._score >= minScore && (distinctiveTerms.length === 0 || p._hasDistinctive))
          .sort((a: any, b: any) => (b._score - a._score) || ((b.rating || 0) - (a.rating || 0)))
          .slice(0, 20);

        const eventTerms = Array.from(new Set([...terms, ...neighborhoodMatchers]));
        const matchEvent = (...fields: any[]) => eventTerms.some(t => fields.some(f => norm(f).split(/\s+/).some((w: string) => w === t || (t.length >= 4 && w.includes(t)))));
        const events = (Array.isArray(allEvents) ? allEvents : [])
          .filter((e: any) => matchEvent(e.name_es, e.title, e.description_es, e.description_en, e.category, e.venue, e.slug));
        const concerts = (Array.isArray(allConcerts) ? allConcerts : [])
          .filter((c: any) => matchEvent(c.title, c.artist, c.genre, c.venue_name, c.description));

        // Merge: if backend returned AI + some partner results, keep AI and add scored partners
        if (hasAI && data) {
          data.partners = scored;
          data.events = events.length > 0 ? events : (data.events || []);
          data.concerts = concerts.length > 0 ? concerts : (data.concerts || []);
        } else {
          data = { partners: scored, events, concerts, venues: [], transport: [], partner_events: [] };
        }
      }

      const normalized: Results = {
        events:         Array.isArray(data?.events) ? data.events : [],
        concerts:       Array.isArray(data?.concerts) ? data.concerts : [],
        partners:       Array.isArray(data?.partners) ? data.partners : [],
        venues:         Array.isArray(data?.venues) ? data.venues : [],
        transport:      Array.isArray(data?.transport) ? data.transport : [],
        partner_events: Array.isArray(data?.partner_events) ? data.partner_events : [],
        ai:             data?.ai,
        search_id:      typeof data?.search_id === 'string' ? data.search_id : undefined,
      };
      setResults(normalized);
    } catch (e) { console.error('[Search] error:', e); }
    setLoading(false);
    Keyboard.dismiss();
  }, [lang]);

  // Keep ref in sync for voice auto-search
  doSearchRef.current = doSearch;

  // Defensive: any of these arrays may be missing if backend returns partial shape
  const len = (a?: any[]) => (Array.isArray(a) ? a.length : 0);
  const totalResults = results
    ? len(results.events) + len(results.concerts) + len(results.partners)
      + len(results.venues) + len(results.transport) + len(results.partner_events)
    : 0;

  // Behavioral loop: report which shown result the user actually chose.
  // Fire-and-forget — never blocks navigation. position -1 = AI pick/highlight.
  const trackTap = (partnerId?: string, position: number = -1) => {
    const sid = results?.search_id;
    if (!sid || !partnerId) return;
    api.post('/search/track-tap', { search_id: sid, partner_id: partnerId, position }).catch(() => {});
  };

  const openHighlight = (h: AIHighlight) => {
    switch (h.type) {
      case 'partner':       trackTap(h.id); router.push(`/partner/${h.id}` as any); break;
      case 'event':         router.push(`/event/${h.id}` as any); break;
      case 'concert':       router.push('/concerts' as any); break;
      case 'transport':     router.push('/transport' as any); break;
      case 'port_tax':      router.push('/port-tax/checkout' as any); break;
      case 'city_pass':     router.push('/(tabs)/citypass' as any); break;
      case 'itinerary':     router.push('/itineraries' as any); break;
      default: break;
    }
  };

  const openSuggestedTab = (tab?: string) => {
    if (!tab) return;
    const route = TAB_TO_ROUTE[tab];
    if (route) router.push(route as any);
  };

  // ── Concierge action handlers (recommendations + actions) ──
  const openRecommendation = (r: AIRecommendation) => {
    if (r.kind === 'event' && r.event_id) {
      router.push(`/event/${r.event_id}` as any);
    } else if (r.kind === 'partner' && r.partner_id) {
      trackTap(r.partner_id);
      router.push(`/partner/${r.partner_id}` as any);
    }
  };

  const handleAction = (a: AIAction) => {
    switch (a.type) {
      case 'open_partner':
        if (a.partner_id) router.push(`/partner/${a.partner_id}` as any);
        break;
      case 'open_event':
        if (a.event_id) router.push(`/event/${a.event_id}` as any);
        break;
      case 'show_partners': {
        const f = a.filters || {};
        const qs: string[] = [];
        if (f.category) qs.push(`category=${encodeURIComponent(f.category)}`);
        if (f.subcategory) qs.push(`subcategory=${encodeURIComponent(f.subcategory)}`);
        if (f.tier) qs.push(`tier=${encodeURIComponent(f.tier)}`);
        router.push(`/(tabs)/partners${qs.length ? '?' + qs.join('&') : ''}` as any);
        break;
      }
      case 'show_events': {
        const f = a.filters || {};
        const qs: string[] = [];
        if (f.category) qs.push(`category=${encodeURIComponent(f.category)}`);
        if (f.date) qs.push(`date=${encodeURIComponent(f.date)}`);
        router.push(`/(tabs)/agenda${qs.length ? '?' + qs.join('&') : ''}` as any);
        break;
      }
      case 'open_port_tax_checkout':
        router.push('/port-tax/checkout' as any);
        break;
      case 'open_city_pass':
        router.push('/(tabs)/citypass' as any);
        break;
      case 'show_itinerary':
        router.push('/itineraries' as any);
        break;
      case 'reservation_link':
        if (a.partner_id) router.push({ pathname: '/reservation/new' as any, params: { partner_id: a.partner_id } });
        break;
      case 'external_link':
        if (a.url) Linking.openURL(a.url).catch(() => {});
        break;
      case 'navigate': {
        const screenMap: Record<string, string> = {
          agenda: '/(tabs)/agenda',
          concerts: '/concerts',
          partners: '/(tabs)/partners',
          citypass: '/(tabs)/citypass',
          transport: '/transport',
          itineraries: '/itineraries',
          search: '/search',
        };
        const route = screenMap[a.screen || ''];
        if (route) router.push(route as any);
        break;
      }
      default:
        break;
    }
  };

  const iconForAction = (type: string): keyof typeof Ionicons.glyphMap => {
    const map: Record<string, keyof typeof Ionicons.glyphMap> = {
      open_partner: 'business',
      open_event: 'calendar',
      show_partners: 'grid',
      show_events: 'calendar-outline',
      open_port_tax_checkout: 'boat',
      open_city_pass: 'ticket',
      show_itinerary: 'map',
      reservation_link: 'restaurant',
      external_link: 'open-outline',
      navigate: 'arrow-forward',
    };
    return map[type] || 'sparkles';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Search Header — Big, comfortable, multi-line capable */}
        <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.primary} style={{ marginTop: 14 }} />
          <TextInput
            style={styles.searchInput}
            placeholder={tr('Pregunta a Amo: cena romántica, paseo a Barú, mariscos…')}
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => doSearch(query)}
            returnKeyType="search"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={4}
            blurOnSubmit
            textAlignVertical="top"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { setQuery(''); setResults(null); setSearched(false); }}
              style={{ marginTop: 14 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {/* Voice input button */}
        <TouchableOpacity
          onPress={listening ? stopListening : startListening}
          style={[styles.micBtn, listening && styles.micBtnActive]}
          activeOpacity={0.85}
        >
          <Ionicons name={listening ? 'radio' : 'mic'} size={22} color={listening ? '#FFF' : COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => doSearch(query)} style={styles.searchBtn} activeOpacity={0.85}>
          <Ionicons name="sparkles" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>{tr('Buscando y pensando…')}</Text>
          </View>
        ) : !searched ? (
          /* Suggestions */
          <View style={styles.suggestions}>
            {listening && (
              <View style={styles.listeningBanner}>
                <Ionicons name="radio" size={20} color="#EF4444" />
                <Text style={styles.listeningText}>
                  {voiceLang === 'es' ? '🎙️ Escuchando en Español…' : '🎙️ Listening in English…'}
                </Text>
                <TouchableOpacity onPress={toggleVoiceLang} style={styles.langToggleBtn}>
                  <Text style={styles.langToggleText}>{voiceLang === 'es' ? '🇬🇧 EN' : '🇪🇸 ES'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={stopListening}>
                  <Ionicons name="close-circle" size={22} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.suggestTitle}>{tr('¿Qué buscas?')}</Text>
            <Text style={styles.suggestSubtitle}>
              {tr('Puedes preguntar: «cena romántica», «cómo llegar a Barú», «conciertos este viernes», «pase cultural», «tasa portuaria»…')}
            </Text>
            <View style={styles.suggestRow}>
              {['Cena romántica', 'Conciertos', 'Lancha a Rosario', 'City Pass', 'Tasa portuaria', 'Brunch', 'Salsa'].map(s => (
                <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => { setQuery(s); doSearch(s); }}>
                  <Ionicons name="sparkles" size={12} color={COLORS.primary} />
                  <Text style={styles.suggestText}>{tr(s)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <>
            {/* AI Concierge Card — Amo's answer + rich recommendation cards */}
            {(results?.ai?.answer || (results?.ai?.recommendations && results.ai.recommendations.length > 0)) ? (
              <View style={styles.aiCard}>
                <View style={styles.aiHeaderRow}>
                  <View style={[
                    styles.aiIntentChip,
                    { backgroundColor: `${INTENT_META[results!.ai!.intent]?.color || COLORS.primary}22` },
                  ]}>
                    <Ionicons
                      name={(INTENT_META[results!.ai!.intent]?.icon || 'sparkles') as any}
                      size={12}
                      color={INTENT_META[results!.ai!.intent]?.color || COLORS.primary}
                    />
                    <Text style={[
                      styles.aiIntentText,
                      { color: INTENT_META[results!.ai!.intent]?.color || COLORS.primary },
                    ]}>
                      {INTENT_META[results!.ai!.intent]?.label || 'AI'}
                    </Text>
                  </View>
                  <Text style={styles.aiBadge}>AMO IA</Text>
                </View>

                {!!results!.ai!.answer && (
                  <Text style={styles.aiAnswer}>{results!.ai!.answer}</Text>
                )}

                {/* Rich recommendation cards (5-8 from the concierge) — fluid horizontal carousel */}
                {!!(results!.ai!.recommendations && results!.ai!.recommendations!.length > 0) && (
                  <RecommendationsCarousel
                    recs={results!.ai!.recommendations!}
                    onPress={openRecommendation}
                  />
                )}

                {/* Action pills (navigation, checkout, etc.) */}
                {!!(results!.ai!.actions && results!.ai!.actions!.length > 0) && (
                  <View style={styles.actionsWrap}>
                    {results!.ai!.actions!.slice(0, 4).map((a, i) => (
                      <TouchableOpacity
                        key={`act-${i}`}
                        style={styles.actionBtn}
                        onPress={() => handleAction(a)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name={iconForAction(a.type)} size={13} color={COLORS.primary} />
                        <Text style={styles.actionBtnText} numberOfLines={1}>
                          {a.label || a.type.replace(/_/g, ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Quick reply suggestions */}
                {!!(results!.ai!.suggestions && results!.ai!.suggestions!.length > 0) && (
                  <View style={styles.suggestionsWrap}>
                    {results!.ai!.suggestions!.slice(0, 4).map((s, i) => (
                      <TouchableOpacity
                        key={`sug-${i}`}
                        style={styles.suggestionPill}
                        onPress={() => { setQuery(s); doSearch(s); }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {!!results!.ai!.suggested_tab && (
                  <TouchableOpacity
                    style={styles.suggestedTabBtn}
                    onPress={() => openSuggestedTab(results!.ai!.suggested_tab)}
                  >
                    <Ionicons name="arrow-forward-circle" size={16} color="#FFF" />
                    <Text style={styles.suggestedTabText}>{tr('Ir a')} {results!.ai!.suggested_tab}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {totalResults === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>{tr('Sin resultados')}</Text>
                <Text style={styles.emptyDesc}>
                  {(results?.ai?.recommendations && results.ai.recommendations.length > 0)
                    ? tr('No encontramos coincidencias exactas, pero la IA tiene sugerencias arriba.')
                    : tr('Intenta con otras palabras como "cena romántica", "playa", "nightlife" o el nombre de un lugar.')}
                </Text>
                <View style={styles.emptyChips}>
                  {['Restaurantes', 'Beach Clubs', 'Nightlife', 'Wellness'].map(chip => (
                    <TouchableOpacity
                      key={chip}
                      style={styles.emptyChip}
                      onPress={() => { setQuery(chip); doSearch(chip); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.emptyChipText}>{tr(chip)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.resultCount}>{totalResults} {totalResults !== 1 ? tr('resultados') : tr('resultado')}</Text>

                {/* Partners */}
                {results!.partners.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>💎 Partners ({results!.partners.length})</Text>
                    {results!.partners.map((p, idx) => (
                      <TouchableOpacity key={p.partner_id} style={styles.resultCard} onPress={() => { trackTap(p.partner_id, idx); router.push(`/partner/${p.partner_id}`); }}>
                        <SafeImage uri={p.image_url} category={p.category} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.resultMeta}>{p.cuisine || (p.subcategory || p.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{p.address}</Text>
                          {p.live_pulse?.title ? (
                            <Text style={styles.pulseRow} numberOfLines={1}>⚡ {tr('HOY')} · {p.live_pulse.title}</Text>
                          ) : null}
                        </View>
                        {p.rating ? (
                          <View style={styles.ratingPill}>
                            <Ionicons name="star" size={10} color="#FBBF24" />
                            <Text style={styles.ratingText}>{Number(p.rating).toFixed(1)}</Text>
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Concerts */}
                {results!.concerts.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🎵 {tr('Conciertos')} ({results!.concerts.length})</Text>
                    {results!.concerts.map(c => (
                      <TouchableOpacity key={c.concert_id} style={styles.resultCard} onPress={() => router.push('/concerts' as any)}>
                        <SafeImage uri={c.image_url} category="concert" style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{c.artist || c.title}</Text>
                          <Text style={styles.resultMeta}>{c.genre}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{c.venue_name} · {c.start_time || c.date}</Text>
                        </View>
                        {c.is_free
                          ? <Text style={styles.resultPrice}>{tr('GRATIS')}</Text>
                          : c.price ? <Text style={styles.resultPrice}>${(c.price / 1000).toFixed(0)}K</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Events (city events) */}
                {results!.events.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📅 {tr('Eventos')} ({results!.events.length})</Text>
                    {results!.events.map((e, i) => (
                      <TouchableOpacity key={e.slug || e.event_id || i} style={styles.resultCard} onPress={() => router.push(`/event/${e.slug || e.event_id}` as any)}>
                        <SafeImage uri={e.image_url} category={e.category || e.type} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={2}>{e.name_es || e.title || e.name_en || '—'}</Text>
                          <Text style={styles.resultMeta}>{e.category || e.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{e.venue || e.venue_name || ''} · {e.time_start || e.start_time || e.date_start || e.date || ''}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Partner Events */}
                {results!.partner_events.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🎉 {tr('Eventos partners')} ({results!.partner_events.length})</Text>
                    {results!.partner_events.map(pe => (
                      <TouchableOpacity key={pe.event_id} style={styles.resultCard} onPress={() => router.push(`/partner-event/${pe.event_id}` as any)}>
                        <SafeImage uri={pe.image_url || (pe as any).flyer_url} category={pe.category} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{pe.title}</Text>
                          <Text style={styles.resultMeta}>{pe.category}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{pe.partner_name}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Transport */}
                {results!.transport.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🚤 {tr('Transporte')} ({results!.transport.length})</Text>
                    {results!.transport.map(t => (
                      <TouchableOpacity key={t.transport_id} style={styles.resultCard} onPress={() => router.push('/transport' as any)}>
                        <View style={[styles.resultImage, styles.transportIcon]}>
                          <Ionicons name="boat" size={24} color={COLORS.primary} />
                        </View>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{t.route}</Text>
                          <Text style={styles.resultMeta}>{t.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{t.departure_point}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Venues */}
                {results!.venues.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📍 Venues ({results!.venues.length})</Text>
                    {results!.venues.map(v => (
                      <TouchableOpacity key={v.venue_id} style={styles.resultCard}>
                        <View style={[styles.resultImage, styles.venueIcon]}>
                          <Ionicons name="location" size={24} color={COLORS.primary} />
                        </View>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{v.name}</Text>
                          <Text style={styles.resultMeta}>{v.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{v.address}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Recommendations Carousel (snap-to-card + page dots) ──
const CARD_WIDTH = 260;
const CARD_GAP = 12;
const CARD_SNAP = CARD_WIDTH + CARD_GAP;

function RecommendationsCarousel({
  recs,
  onPress,
}: {
  recs: AIRecommendation[];
  onPress: (r: AIRecommendation) => void;
}) {
  const tr = useTr();
  const [activeIdx, setActiveIdx] = React.useState(0);
  const onScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x as number;
    const idx = Math.round(x / CARD_SNAP);
    if (idx !== activeIdx) setActiveIdx(Math.max(0, Math.min(recs.length - 1, idx)));
  };
  return (
    <View style={{ marginTop: 4 }}>
      <View style={styles.carouselHeader}>
        <Text style={styles.carouselTitle}>
          ✨ {recs.length} {tr('opciones para ti')}
        </Text>
        <Text style={styles.carouselHint}>{tr('Desliza')} →</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_SNAP}
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={styles.recsScrollContent}
        style={styles.recsScroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {recs.map((r, i) => (
          <RecommendationCard
            key={`rec-${i}-${r.partner_id || r.event_id}`}
            rec={r}
            onPress={() => onPress(r)}
          />
        ))}
      </ScrollView>
      {/* Page dots */}
      {recs.length > 1 && (
        <View style={styles.dotsRow}>
          {recs.map((_, i) => (
            <View
              key={`dot-${i}`}
              style={[
                styles.dot,
                i === activeIdx && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Rich Recommendation Card (concierge partner/event picks) ──
function RecommendationCard({
  rec,
  onPress,
}: {
  rec: AIRecommendation;
  onPress: () => void;
}) {
  const tr = useTr();
  const isEvent = rec.kind === 'event';
  const accent = isEvent ? '#7C3AED' : COLORS.primary;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.recCard}>
      <View style={[styles.recHeader, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
        <View style={[styles.recIcon, { backgroundColor: accent }]}>
          <Ionicons name={isEvent ? 'calendar' : 'business'} size={13} color={COLORS.white} />
        </View>
        <Text style={[styles.recKindLabel, { color: accent }]} numberOfLines={1}>
          {isEvent ? tr('Evento') : 'Partner'}
        </Text>
        {!!rec.price_range && (
          <View style={styles.recPriceBadge}>
            <Text style={styles.recPriceText}>{rec.price_range}</Text>
          </View>
        )}
      </View>
      <View style={styles.recBody}>
        <Text style={styles.recName} numberOfLines={2}>{rec.name}</Text>
        {!!rec.type && <Text style={styles.recType} numberOfLines={1}>{rec.type}</Text>}
        {!!rec.vibe && (
          <View style={styles.recMetaRow}>
            <Ionicons name="sparkles" size={11} color={COLORS.textMuted} />
            <Text style={styles.recVibe} numberOfLines={2}>{rec.vibe}</Text>
          </View>
        )}
        {!!rec.reason && (
          <Text style={styles.recReason} numberOfLines={3}>{rec.reason}</Text>
        )}
        {!!rec.address && (
          <View style={styles.recMetaRow}>
            <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.recVibe} numberOfLines={1}>{rec.address}</Text>
          </View>
        )}
      </View>
      <View style={styles.recCta}>
        <Text style={styles.recCtaText}>{tr('Ver detalle')}</Text>
        <Ionicons name="arrow-forward" size={12} color={COLORS.white} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: COLORS.primary + '55',
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.regular,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 48,
    maxHeight: 140,
    lineHeight: 22,
  },
  langToggleBtn: { backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.primary + '40' },
  langToggleText: { fontSize: 12, color: COLORS.primary, fontWeight: '700' as const },
  micBtn: { width: 48, height: 48, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary + '40', alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  listeningBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: '#EF444418', borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: '#EF444430' },
  listeningText: { flex: 1, fontSize: 14, color: '#EF4444', ...FONTS.semibold },
  listeningStop: { fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, textDecorationLine: 'underline' as const },
  searchBtn: { width: 48, height: 48, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  loadingWrap: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm },
  loadingText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },

  suggestions: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl },
  suggestTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginBottom: 6 },
  suggestSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 19, marginBottom: SPACING.md },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
  },
  suggestText: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },

  // AI card
  aiCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5, borderColor: 'rgba(217,119,6,0.35)',
    gap: SPACING.sm,
  },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  aiIntentChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  aiIntentText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.5 },
  aiBadge: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, marginLeft: 'auto' },
  aiAnswer: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 20 },
  aiHighlights: { gap: 6, marginTop: 4 },
  aiPick: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
  },
  aiPickText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.medium },
  suggestedTabBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 10, borderRadius: RADIUS.full,
    marginTop: 4,
  },
  suggestedTabText: { fontSize: 13, color: '#FFF', ...FONTS.bold },

  emptyState: { alignItems: 'center', paddingTop: 40, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  emptyDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 19 },
  emptyChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  emptyChip: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 8 },
  emptyChipText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },

  resultCount: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, textTransform: 'uppercase', letterSpacing: 0.5 },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm, letterSpacing: 0.3 },

  resultCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  resultImage: { width: 52, height: 52, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  venueIcon: { backgroundColor: `${COLORS.primary}15`, alignItems: 'center', justifyContent: 'center' },
  transportIcon: { backgroundColor: 'rgba(59,130,246,0.15)', alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1, gap: 1 },
  resultName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  resultMeta: { fontSize: 11, color: COLORS.primary, ...FONTS.medium, textTransform: 'capitalize' },
  resultSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  pulseRow: { fontSize: 11, color: '#FBBF24', ...FONTS.medium, marginTop: 2 },
  resultPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(251,191,36,0.15)', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  ratingText: { fontSize: 11, color: '#FBBF24', ...FONTS.bold },

  // ── Concierge: recommendation cards (horizontal scroll) ──
  recsScroll: { marginHorizontal: -SPACING.md, marginTop: SPACING.xs },
  recsScrollContent: { paddingHorizontal: SPACING.md, paddingRight: SPACING.lg },
  carouselHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    marginBottom: 6,
  },
  carouselTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.2 },
  carouselHint: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, letterSpacing: 0.3 },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 10,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    width: 18,
    backgroundColor: COLORS.primary,
  },
  recCard: {
    width: 260,
    marginRight: 12,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  recIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  recKindLabel: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.4, flex: 1 },
  recPriceBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  recPriceText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },
  recBody: { padding: 10, gap: 4 },
  recName: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, lineHeight: 18 },
  recType: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, textTransform: 'capitalize' },
  recMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recVibe: { flex: 1, fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  recReason: { fontSize: 11, color: COLORS.textMain, ...FONTS.regular, lineHeight: 15, marginTop: 4 },
  recCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingVertical: 9,
  },
  recCtaText: { fontSize: 12, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.3 },

  // ── Action pills ──
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.xs },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)',
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: RADIUS.full,
  },
  actionBtnText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },

  // ── Quick reply suggestions ──
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.xs },
  suggestionPill: {
    backgroundColor: COLORS.background,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  suggestionText: { fontSize: 11, color: COLORS.textMain, ...FONTS.medium },
});
