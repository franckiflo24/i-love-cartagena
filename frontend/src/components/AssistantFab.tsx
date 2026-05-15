/**
 * Floating AI Concierge Assistant ("Amo") — global FAB + chat modal.
 * Lives at the root of the (tabs) layout and is visible everywhere except inside
 * already-modal screens.
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';
import { useLang } from '../context/LanguageContext';

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
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  recommendations?: Recommendation[];
  suggestions?: string[];
  language?: string;
  created_at?: string;
};

const STORAGE_SESSION_KEY = 'amo_agent_session_id';

// Pulse animation hook for FAB
function usePulse() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 1100, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(scale, { toValue: 1.0, duration: 1100, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    ).start();
  }, [scale]);
  return scale;
}

export default function AssistantFab() {
  const router = useRouter();
  const pathname = usePathname();
  const { lang, s } = useLang();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulse = usePulse();

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
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Welcome message when opening with no messages
  useEffect(() => {
    if (open && messages.length === 0 && !sessionId) {
      const welcome: Record<string, { msg: string; sugg: string[] }> = {
        es: {
          msg: '¡Hola! Soy Amo, tu concierge digital de Cartagena 🌴 Puedo ayudarte a encontrar restaurantes, conciertos, planear tu día, comprar el City Pass o ir a las islas. ¿Qué necesitás?',
          sugg: ['¿Qué hay esta noche?', 'Comer mariscos cerca', 'Ir a las islas mañana', 'Comprar City Pass'],
        },
        en: {
          msg: "Hi! I'm Amo, your digital concierge in Cartagena 🌴 I can help you find restaurants, concerts, plan your day, buy the City Pass or visit the islands. What do you need?",
          sugg: ["What's on tonight?", 'Find seafood nearby', 'Visit the islands tomorrow', 'Buy City Pass'],
        },
        fr: {
          msg: "Bonjour ! Je suis Amo, votre concierge digital à Carthagène 🌴 Je peux vous aider à trouver des restaurants, concerts, planifier votre journée, acheter le City Pass ou aller aux îles. Que voulez-vous ?",
          sugg: ['Que faire ce soir ?', 'Fruits de mer à proximité', 'Aller aux îles demain', 'Acheter City Pass'],
        },
        pt: {
          msg: 'Olá! Eu sou Amo, seu concierge digital em Cartagena 🌴 Posso te ajudar a encontrar restaurantes, shows, planejar seu dia, comprar o City Pass ou visitar as ilhas. O que você precisa?',
          sugg: ['O que tem hoje à noite?', 'Frutos do mar perto', 'Ir às ilhas amanhã', 'Comprar City Pass'],
        },
      };
      const w = welcome[lang] || welcome.es;
      setMessages([{ role: 'assistant', content: w.msg, suggestions: w.sugg }]);
    }
  }, [open, messages.length, sessionId, lang]);

  // Load existing session messages when opening
  useEffect(() => {
    (async () => {
      if (open && sessionId && messages.length === 0) {
        try {
          const s = await api.get(`/agent/session/${sessionId}`);
          if (s && Array.isArray(s.messages) && s.messages.length) {
            setMessages(s.messages);
          }
        } catch {
          /* ignore */
        }
      }
    })();
  }, [open, sessionId, messages.length]);

  const persistSession = useCallback(async (sid: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(STORAGE_SESSION_KEY, sid);
      } else {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        await AsyncStorage.setItem(STORAGE_SESSION_KEY, sid);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed || sending) return;
      setSending(true);
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      // typing indicator
      setMessages((prev) => [...prev, { role: 'assistant', content: '__typing__' }]);
      try {
        const res = await api.post('/agent/chat', {
          message: trimmed,
          session_id: sessionId,
          screen_context: pathname,
          language: lang,
        });
        const sid: string = res.session_id;
        if (sid !== sessionId) {
          setSessionId(sid);
          persistSession(sid);
        }
        const a = res.assistant;
        setMessages((prev) => {
          const next = prev.filter((m) => m.content !== '__typing__');
          return [
            ...next,
            {
              role: 'assistant',
              content: a.content,
              actions: a.actions || [],
              suggestions: a.suggestions || [],
              language: a.language,
            },
          ];
        });
      } catch (e: any) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.content !== '__typing__');
          return [
            ...next,
            {
              role: 'assistant',
              content: 'Tuve un problema para responder. Probá de nuevo en un momento 🙏',
            },
          ];
        });
      }
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    },
    [sending, sessionId, persistSession, pathname],
  );

  const onAction = useCallback(
    (a: Action) => {
      switch (a.type) {
        case 'navigate': {
          if (!a.screen) return;
          const map: Record<string, string> = {
            agenda: '/(tabs)/agenda',
            concerts: '/(tabs)/concerts',
            partners: '/(tabs)/partners',
            citypass: '/(tabs)/citypass',
            transport: '/(tabs)/transport',
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
          router.push({ pathname: '/event/[id]' as any, params: { id: a.event_id } });
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
    [router],
  );

  const newChat = useCallback(async () => {
    setMessages([]);
    setSessionId(null);
    persistSession('');
  }, [persistSession]);

  return (
    <>
      {/* Floating Action Button */}
      <Animated.View style={[styles.fab, { transform: [{ scale: pulse }] }]} pointerEvents="box-none">
        <TouchableOpacity
          accessibilityLabel="Asistente Amo"
          activeOpacity={0.85}
          onPress={() => setOpen(true)}
          style={styles.fabBtn}
        >
          <View style={styles.fabBadge}><Text style={styles.fabBadgeText}>AI</Text></View>
          <Ionicons name="sparkles" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </Animated.View>

      {/* Chat Modal */}
      <Modal
        visible={open}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.modalWrap} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={16} color={COLORS.white} />
              </View>
              <View>
                <Text style={styles.headerTitle}>Amo</Text>
                <Text style={styles.headerSub}>{s('assistant_subtitle')}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={newChat} style={styles.headerBtn}>
                <Ionicons name="create-outline" size={20} color={COLORS.textMuted} />
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
              {messages.map((m, idx) => (
                <MessageBubble key={idx} m={m} onAction={onAction} onSuggestion={send} />
              ))}
            </ScrollView>

            <View style={styles.inputBar}>
              <TextInput
                placeholder={s('assistant_placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={input}
                onChangeText={setInput}
                style={styles.input}
                multiline
                maxLength={500}
                editable={!sending}
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

function MessageBubble({
  m,
  onAction,
  onSuggestion,
}: {
  m: Message;
  onAction: (a: Action) => void;
  onSuggestion: (text: string) => void;
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
      <View style={[styles.bubble, styles.bubbleAssist, { alignSelf: 'flex-start' }]}>
        <TypingDots />
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-start', gap: 6 }}>
      <View style={[styles.bubble, styles.bubbleAssist]}>
        <Text style={styles.bubbleAssistText}>{m.content}</Text>
      </View>
      {!!(m.actions && m.actions.length) && (
        <View style={styles.actionsWrap}>
          {m.actions.map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={() => onAction(a)} activeOpacity={0.85}>
              <Ionicons name={iconForAction(a.type)} size={13} color={COLORS.primary} />
              <Text style={styles.actionBtnText} numberOfLines={1}>
                {a.label || defaultLabel(a)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!!(m.suggestions && m.suggestions.length) && (
        <View style={styles.actionsWrap}>
          {m.suggestions.slice(0, 4).map((s, i) => (
            <Pressable key={i} style={styles.suggestionPill} onPress={() => onSuggestion(s)}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function TypingDots() {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const seq = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
      );
    seq(a1, 0).start();
    seq(a2, 150).start();
    seq(a3, 300).start();
  }, [a1, a2, a3]);
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 4 }}>
      {[a1, a2, a3].map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: COLORS.textMuted,
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

function defaultLabel(a: Action): string {
  switch (a.type) {
    case 'navigate':
      return `Ir a ${a.screen}`;
    case 'show_partners':
      return 'Ver partners';
    case 'show_events':
      return 'Ver eventos';
    case 'open_partner':
      return 'Ver partner';
    case 'open_event':
      return 'Ver evento';
    case 'open_port_tax_checkout':
      return 'Comprar Tasa Portuaria';
    case 'open_city_pass':
      return 'Comprar City Pass';
    case 'reservation_link':
      return 'Reservar';
    case 'show_itinerary':
      return 'Ver itinerario';
    case 'external_link':
      return 'Abrir';
    default:
      return 'Acción';
  }
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 95 : 90,
    zIndex: 999,
  },
  fabBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#22C55E',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
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
    borderBottomColor: COLORS.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold },
  headerSub: { color: COLORS.textMuted, fontSize: 10, ...FONTS.regular, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: SPACING.xs },
  headerBtn: { padding: 6 },

  bubble: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: COLORS.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleUserText: { color: COLORS.white, fontSize: 14, ...FONTS.regular, lineHeight: 19 },
  bubbleAssist: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 4,
  },
  bubbleAssistText: { color: COLORS.textMain, fontSize: 14, ...FONTS.regular, lineHeight: 19 },

  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '90%' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionBtnText: { color: COLORS.primary, fontSize: 11.5, ...FONTS.bold, maxWidth: 200 },

  suggestionPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    borderTopColor: COLORS.border,
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
