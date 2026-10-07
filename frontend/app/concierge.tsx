import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { AGENTS, AGENT_ORDER, AgentId, ConciergeAgent } from '../src/constants/agents';
import { askAgentFull, ChatMessage } from '../src/services/concierge';
import { LUNA_STR, RecRow, enrichRecommendations, localQuickRecs, type Recommendation } from '../src/components/concierge/LunaRecs';
import { loadCatalog } from '../src/lib/lunaOffline';
import type { Lang } from '../src/i18n/translations';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';
import { useLang } from '../src/context/LanguageContext';
import { API_BASE } from '../src/constants/api';
import { useSignupGate } from '../src/context/SignupGateContext';
import { trackGate, getArchetype } from '../src/lib/gateAnalytics';
import { cmwActionLinks, type CmwActionLinks } from '../src/lib/cmw';
import { goHome } from '../src/lib/nav';
import { openExternal } from '../src/lib/cityModules';

// ── Agent Card ──
function AgentCard({ agent, onPress }: { agent: ConciergeAgent; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tr = useTr();
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 180, friction: 22 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 180, friction: 22 }).start();

  return (
    <TouchableOpacity style={styles.agentCell} activeOpacity={1} onPressIn={pressIn} onPressOut={pressOut} onPress={onPress}>
      <Animated.View style={[styles.agentCard, { transform: [{ scale }], borderColor: agent.accent + '30' }]}>
        <View style={[styles.agentEmojiWrap, { backgroundColor: agent.accent + '18' }]}>
          <Text style={styles.agentEmoji}>{agent.emoji}</Text>
        </View>
        <Text style={styles.agentName}>{agent.name}</Text>
        <Text style={styles.agentTagline}>{tr(agent.tagline)}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Typing Dots ──
function TypingDots({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    dots.forEach((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ])).start()
    );
  }, []);
  return (
    <View style={[styles.bubble, styles.bubbleAgent, { flexDirection: 'row', gap: 6, paddingVertical: 16 }]}>
      {dots.map((d, i) => <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, opacity: d, backgroundColor: color }} />)}
    </View>
  );
}

// Luna's event actions (EVENTS-ELITE §13 I2/J5): `navigate` to 'agenda'/'concerts'
// or `show_events` → the verified feed on web / 1.1.2. Anything else is ignored.
type TasteAction = { type?: unknown; screen?: unknown };
const pointsToEvents = (actions: unknown): boolean =>
  Array.isArray(actions) && actions.some((a: TasteAction) =>
    !!a && (a.type === 'show_events' || (a.type === 'navigate' && (a.screen === 'agenda' || a.screen === 'concerts'))));

// ── Main ──
export default function ConciergeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const tr = useTr();
  const { lang } = useLang();
  const { openGate } = useSignupGate();
  const { agent: routeAgent } = useLocalSearchParams<{ agent?: string }>();
  const enteredDirect = !!(routeAgent && AGENTS[routeAgent as AgentId]);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(
    enteredDirect ? (routeAgent as AgentId) : null
  );
  // Exit that always works: router.back() is a silent no-op on a deep-linked
  // or fresh stack (part of Phil's "can't exit" report) — fall back to home.
  const exitScreen = () => { if (router.canGoBack()) router.back(); else goHome(router); };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chipsVisible, setChipsVisible] = useState(true);
  // Indices of assistant messages whose reply carried an events action.
  const [eventLinkAt, setEventLinkAt] = useState<number[]>([]);
  // Cartagena Music Week links per assistant message (docs/cmw/DESIGN.md §5): the
  // public hub URL opens in-app, the concierge wa.me link opens externally.
  const [cmwLinksAt, setCmwLinksAt] = useState<Record<number, CmwActionLinks>>({});
  const scrollRef = useRef<ScrollView>(null);
  const agent = activeAgent ? AGENTS[activeAgent] : null;

  const openAgent = (id: AgentId) => {
    setActiveAgent(id);
    setMessages([]);
    setEventLinkAt([]);
    setCmwLinksAt({});
    setChipsVisible(true);
    setInput('');
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || !activeAgent || loading) return;

    // Drop GATE (B2): a logged-out visitor gets ONE real Luna exchange (the
    // cold-conversion taste), then the wall fires on the 2nd message.
    if (!user) {
      let tasted = false;
      try { tasted = sessionStorage.getItem('amo_luna_tasted') === '1'; } catch {}
      if (tasted) {
        openGate({ action: 'luna', next: '/concierge' });
        return;
      }
      const um: ChatMessage = { role: 'user', content: text.trim() };
      setChipsVisible(false);
      setMessages([...messages, um]);
      setInput('');
      setLoading(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      try {
        const r = await fetch(`${API_BASE}/agent/taste`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim(), language: lang }),
        });
        if (r.ok) {
          const d = await r.json();
          try { sessionStorage.setItem('amo_luna_tasted', '1'); } catch {}
          trackGate('luna_taste', { action: 'luna', archetype: getArchetype() });
          // The assistant reply lands right after the user message appended above.
          if (pointsToEvents(d?.assistant?.actions)) setEventLinkAt((l) => [...l, messages.length + 1]);
          const cmwGuest = cmwActionLinks(d?.assistant?.actions);
          if (cmwGuest.path || cmwGuest.whatsapp) setCmwLinksAt((m) => ({ ...m, [messages.length + 1]: cmwGuest }));
          // Taste carries the full payload too: cards + follow-ups, same as paid turns.
          const gRecs: Recommendation[] = Array.isArray(d?.assistant?.recommendations) ? d.assistant.recommendations : [];
          const gSuggs: string[] = Array.isArray(d?.assistant?.suggestions)
            ? d.assistant.suggestions.filter((s: unknown) => typeof s === 'string') : [];
          let gEnriched = gRecs;
          try { gEnriched = enrichRecommendations(gRecs, await loadCatalog()); } catch {}
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: d?.assistant?.message || '¿En qué te ayudo?',
            recommendations: gEnriched,
            suggestions: gSuggs,
          }]);
        } else {
          // taste already used (429) or unavailable → the wall
          openGate({ action: 'luna', next: '/concierge' });
        }
      } catch {
        openGate({ action: 'luna', next: '/concierge' });
      }
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      return;
    }

    setChipsVisible(false);
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

    // Instant-local-then-enrich (Luna): show real venue CARDS from the bundled catalog
    // in <1s while the LLM composes the full answer, then replace with it. `answered`
    // guards the (much faster) preview from overwriting the real reply. The preview
    // only fires on real venue intent (LunaRecs gate) — never on "I don't see the list".
    let answered = false;
    let provisionalRecs: Recommendation[] = [];
    if (activeAgent === 'luna') {
      localQuickRecs(text.trim(), lang as Lang).then((recs) => {
        if (recs.length && !answered) {
          provisionalRecs = recs;
          const preview = (LUNA_STR[lang as Lang] || LUNA_STR.es).preview;
          setMessages([...updated, { role: 'assistant', content: preview, recommendations: recs, provisional: true }]);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
        }
      }).catch(() => {});
    }

    const { reply, actions, recommendations, suggestions } = await askAgentFull(activeAgent, updated, lang);
    answered = true;
    // The assistant reply lands at index updated.length: show the verified-agenda link
    // when Luna answered an event question (navigate → agenda / show_events).
    if (pointsToEvents(actions)) setEventLinkAt((l) => [...l, updated.length]);
    const cmw = cmwActionLinks(actions);
    if (cmw.path || cmw.whatsapp) setCmwLinksAt((m) => ({ ...m, [updated.length]: cmw }));
    // Backfill image/category from the bundled catalog; a reply with no cards keeps
    // the provisional's local cards so a promised list can never render as nothing.
    let enriched = recommendations;
    try { enriched = enrichRecommendations(recommendations, await loadCatalog()); } catch {}
    setMessages([...updated, {
      role: 'assistant',
      content: reply,
      recommendations: enriched.length ? enriched : provisionalRecs,
      suggestions,
    }]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  // ══════════════ PICKER ══════════════
  if (!agent) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.pickerHeader}>
          <TouchableOpacity onPress={exitScreen} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
        </View>

        <ScrollView contentContainerStyle={styles.pickerScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.pickerHero}>
            <View style={styles.pickerIconCircle}>
              <Ionicons name="sparkles" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.pickerTitle}>Amo IA</Text>
            <Text style={styles.pickerSubtitle}>{tr('Tu concierge personal de Cartagena.\nElige un agente para empezar.')}</Text>
          </View>

          <View style={styles.pickerGrid}>
            {AGENT_ORDER.map(id => (
              <AgentCard key={id} agent={AGENTS[id]} onPress={() => openAgent(id)} />
            ))}
          </View>

          <Text style={styles.pickerFooter}>
            {tr('Cada agente conoce Cartagena y recomienda\nsolo lugares verificados de AMO.')}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ══════════════ CHAT ══════════════
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {/* Header */}
        <View style={[styles.chatHeader, { borderBottomColor: agent.accent + '20' }]}>
          {/* Entered straight into a chat (home bar → Luna)? Back exits the
              screen — the user never saw the picker, don't strand them in it. */}
          <TouchableOpacity onPress={() => (enteredDirect ? exitScreen() : setActiveAgent(null))} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={[styles.headerEmojiWrap, { backgroundColor: agent.accent + '18' }]}>
            <Text style={{ fontSize: 20 }}>{agent.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatHeaderName}>{agent.name}</Text>
            <Text style={styles.chatHeaderTag}>{tr(agent.tagline)}</Text>
          </View>
          {/* Switch agent mini chips */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {AGENT_ORDER.filter(id => id !== activeAgent).map(id => (
              <TouchableOpacity key={id} onPress={() => openAgent(id)} style={styles.switchChip}>
                <Text style={{ fontSize: 14 }}>{AGENTS[id].emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Messages */}
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled">
          {/* Opening */}
          <View style={[styles.bubble, styles.bubbleAgent]}>
            <Text style={[styles.bubbleLabel, { color: agent.accent }]}>{agent.emoji} {agent.name}</Text>
            <Text style={styles.bubbleText}>{tr(agent.opening)}</Text>
          </View>

          {/* Chips */}
          {chipsVisible && (
            <View style={styles.chipsWrap}>
              {agent.starterChips.map((chip, i) => (
                <TouchableOpacity key={i} style={[styles.chip, { borderColor: agent.accent + '40', backgroundColor: agent.accent + '0D' }]} onPress={() => sendMessage(tr(chip))} activeOpacity={0.8}>
                  {/* sendMessage(tr(chip)): send what the user SAW — an EN device tapping
                      an EN chip must never echo a Spanish user bubble. */}
                  <Text style={[styles.chipText, { color: agent.accent }]}>{tr(chip)}</Text>
                  <Ionicons name="arrow-forward" size={12} color={agent.accent} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Messages */}
          {messages.map((msg, i) => {
            // Strip any residual markdown ** from AI responses
            const text = msg.role === 'assistant'
              ? msg.content.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
              : msg.content;
            return (
              <View key={i}>
              <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleAgent, msg.provisional && styles.bubbleProvisional]}>
                {msg.role === 'assistant' && (
                  <Text style={[styles.bubbleLabel, { color: agent.accent }]}>
                    {agent.emoji} {agent.name}{msg.provisional ? ` · ⚡ ${tr('al instante')}` : ''}
                  </Text>
                )}
                <Text style={[styles.bubbleText, msg.role === 'user' && { color: COLORS.black }]}>{text}</Text>
                {msg.role === 'assistant' && eventLinkAt.includes(i) && (
                  <TouchableOpacity
                    onPress={() => router.push('/que-pasa' as never)}
                    style={[styles.eventLink, { borderColor: agent.accent + '55' }]}
                    accessibilityRole="button"
                    testID="concierge-que-pasa-link"
                  >
                    <Ionicons name="calendar-outline" size={14} color={agent.accent} />
                    <Text style={[styles.eventLinkText, { color: agent.accent }]}>{tr('Qué pasa en Cartagena')}</Text>
                    <Ionicons name="arrow-forward" size={13} color={agent.accent} />
                  </TouchableOpacity>
                )}
                {msg.role === 'assistant' && !!cmwLinksAt[i] && (
                  <View style={styles.cmwLinks}>
                    {!!cmwLinksAt[i].path && (
                      <TouchableOpacity
                        onPress={() => router.push(cmwLinksAt[i].path as never)}
                        style={[styles.eventLink, { borderColor: agent.accent + '55' }]}
                        accessibilityRole="button"
                        testID="concierge-cmw-link"
                      >
                        <Ionicons name="musical-notes-outline" size={14} color={agent.accent} />
                        <Text style={[styles.eventLinkText, { color: agent.accent }]}>Cartagena Music Week</Text>
                        <Ionicons name="arrow-forward" size={13} color={agent.accent} />
                      </TouchableOpacity>
                    )}
                    {!!cmwLinksAt[i].whatsapp && (
                      <TouchableOpacity
                        onPress={() => openExternal(cmwLinksAt[i].whatsapp as string)}
                        style={[styles.eventLink, { borderColor: agent.accent + '55' }]}
                        accessibilityRole="link"
                        testID="concierge-cmw-whatsapp"
                      >
                        <Ionicons name="logo-whatsapp" size={14} color={agent.accent} />
                        <Text style={[styles.eventLinkText, { color: agent.accent }]}>{tr('Escribir por WhatsApp')}</Text>
                        <Ionicons name="open-outline" size={13} color={agent.accent} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Recommendation cards — the actual list Luna's text promises.
                  LunaRecs pipeline, same cards as the FAB (gold-medal rule:
                  a reply that says "here are the picks:" NEVER renders bare). */}
              {msg.role === 'assistant' && !!(msg.recommendations && msg.recommendations.length) && (
                <View style={styles.recsWrap}>
                  <RecRow
                    recs={msg.recommendations}
                    lang={lang as Lang}
                    onPressRec={(r) => {
                      if (r.kind === 'event' && r.event_id) {
                        router.push({ pathname: '/event/[id]' as any, params: { id: r.event_id } });
                      } else if (r.partner_id) {
                        router.push({ pathname: '/partner/[id]' as any, params: { id: r.partner_id } });
                      }
                    }}
                  />
                </View>
              )}

              {/* Tappable follow-ups from Luna — one tap continues the thread. */}
              {msg.role === 'assistant' && !msg.provisional && !!(msg.suggestions && msg.suggestions.length) && (
                <View style={styles.suggestionsWrap}>
                  {msg.suggestions.slice(0, 4).map((sugg, k) => (
                    <TouchableOpacity
                      key={k}
                      style={[styles.suggestionPill, { borderColor: agent.accent + '40' }]}
                      onPress={() => sendMessage(sugg)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.suggestionText, { color: agent.accent }]} numberOfLines={1}>{sugg}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              </View>
            );
          })}

          {loading && <TypingDots color={agent.accent} />}
          <View style={{ height: 16 }} />
        </ScrollView>

        {/* Input */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.inputField}
            value={input}
            onChangeText={setInput}
            placeholder={tr('Escríbele a {name}...').replace('{name}', agent.name)}
            placeholderTextColor={COLORS.textFaint}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            editable={!loading}
            multiline={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.35 }]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <Ionicons name="send" size={18} color={COLORS.black} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },

  // ── Picker ──
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  pickerScroll: { paddingBottom: SPACING.xxl },
  pickerHero: { alignItems: 'center', paddingTop: SPACING.xl, paddingBottom: SPACING.lg },
  pickerIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  pickerTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  pickerSubtitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.sm, lineHeight: 20 },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  // Two per row from CSS alone: a 40% basis lets exactly two cells share a row
  // and flexGrow splits it evenly — (row − gap) / 2 at any width. The old
  // module-scope Dimensions.get() width was 0 during the web static render (the
  // card width went missing from the HTML → hydration mismatch) and the full
  // browser width on desktop (cards wider than the phone shell).
  agentCell: { flexBasis: '40%', flexGrow: 1 },
  agentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.lg,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  agentEmojiWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  agentEmoji: { fontSize: 24 },
  agentName: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  agentTagline: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  pickerFooter: { fontSize: 11, color: COLORS.textFaint, textAlign: 'center', marginTop: SPACING.xl, lineHeight: 16, ...FONTS.medium },

  // ── Chat Header ──
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1 },
  headerEmojiWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chatHeaderName: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  chatHeaderTag: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  switchChip: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },

  // ── Chat Body ──
  chatContent: { padding: SPACING.md, gap: SPACING.sm },
  bubble: { maxWidth: '88%', borderRadius: RADIUS.lg, padding: SPACING.md },
  bubbleAgent: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderTopLeftRadius: 4 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: COLORS.primary, borderTopRightRadius: 4 },
  bubbleProvisional: { borderStyle: 'dashed', borderColor: COLORS.primary + '66', opacity: 0.92 },
  // LunaRecs card row + follow-up pills, siblings under the assistant bubble
  recsWrap: { marginTop: 8, marginBottom: 4, alignSelf: 'stretch' },
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  suggestionPill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full,
    borderWidth: 1, backgroundColor: COLORS.surface,
  },
  suggestionText: { fontSize: 12.5, ...FONTS.medium },
  bubbleLabel: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  bubbleText: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 21 },

  // ── Chips ──
  chipsWrap: { gap: SPACING.sm, paddingVertical: SPACING.xs },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: 12, gap: SPACING.sm },
  chipText: { fontSize: 14, ...FONTS.medium, flex: 1 },
  eventLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36,
    marginTop: SPACING.sm, paddingHorizontal: 12, borderRadius: RADIUS.full, borderWidth: 1,
  },
  eventLinkText: { fontSize: 13, ...FONTS.semibold },
  cmwLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // ── Input ──
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, paddingBottom: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  inputField: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 12, fontSize: 14, color: COLORS.textMain, ...FONTS.regular, borderWidth: 1, borderColor: COLORS.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
});
