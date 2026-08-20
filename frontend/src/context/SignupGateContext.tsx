// Drop GATE — the preview-then-gate wall. ONE honest, reusable signup wall.
//
// Any DO-action (collect a stamp, add to a trip, keep chatting with Luna, save,
// book) calls openGate({action, next}) instead of dumping to a raw /login. The
// wall appears as a MODAL OVER the current screen (the preview stays visible
// behind it — the preview IS the hook, never walled) and:
//   • names the specific thing they'll unlock ("para coleccionar este sello")
//   • is honest: "cuenta gratis" because the consumer app IS free
//   • one tap → /login?next=<the exact action> → after signup the Drop FR
//     arrival runs (activation) and then returns to <next> (see login/onboarding
//     next-passthrough). Never a generic dump to home.
//   • is skippable back to the preview — never a trap.
//
// Security: this is a PRODUCT wall, not a security boundary. Server-side auth /
// IDOR / rate-limit / no-enumeration are unchanged; a gated action still fails
// server-side if attempted unauthenticated.
import React, { createContext, useContext, useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { trackGate } from '../lib/gateAnalytics';
import { safeNext } from '../lib/safeNext';
import { useTr } from '../i18n/autoTr';

const GOLD = '#12B5A5';
const GOLD_BRIGHT = '#FF6B75';

export type GateAction =
  | 'collect_stamp' | 'add_trip' | 'create_trip' | 'join_trip' | 'luna'
  | 'favorite' | 'passport' | 'book' | 'review' | 'reward' | 'personalize' | 'generic';

// What each DO-action unlocks — honest, specific, second person.
const ACTION_COPY: Record<GateAction, string> = {
  collect_stamp: 'para coleccionar este sello',
  add_trip: 'para agregar esto a tu viaje',
  create_trip: 'para armar tu viaje',
  join_trip: 'para unirte a este viaje',
  luna: 'para seguir chateando con Luna',
  favorite: 'para guardar tus favoritos',
  passport: 'para empezar tu pasaporte',
  book: 'para reservar',
  review: 'para dejar tu reseña',
  reward: 'para reclamar esto',
  personalize: 'para personalizar tu Cartagena',
  generic: 'para continuar',
};

interface GateOpts { action?: GateAction; next?: string; archetype?: 'invited' | 'cold'; }

const SignupGateContext = createContext<{ openGate: (o?: GateOpts) => void }>({ openGate: () => {} });
export const useSignupGate = () => useContext(SignupGateContext);

export const SignupGateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<GateOpts>({});

  const openGate = useCallback((o: GateOpts = {}) => {
    const archetype = o.archetype
      || ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('amo_archetype')) as any)
      || 'cold';
    setOpts({ ...o, archetype });
    setOpen(true);
    trackGate('gate_shown', { action: o.action || 'generic', archetype });
  }, []);

  const proceed = useCallback(() => {
    const action = opts.action || 'generic';
    const archetype = (opts.archetype || 'cold') as 'invited' | 'cold';
    trackGate('gate_cta', { action, archetype });
    // Attribute the eventual signup to the archetype + action that walled them.
    try {
      sessionStorage.setItem('amo_gate_attr', JSON.stringify({ action, archetype }));
    } catch {}
    setOpen(false);
    // GATE-2B: the ONE canonical guard (was a weaker inline check that let the
    // backslash open-redirect '/\evil.com' through — see src/lib/safeNext).
    const next = safeNext(opts.next) ?? undefined;
    router.push({ pathname: '/login' as any, params: next ? { next } : {} });
  }, [opts, router]);

  const dismiss = useCallback(() => {
    trackGate('gate_dismissed', { action: opts.action || 'generic', archetype: (opts.archetype || 'cold') as any });
    setOpen(false);
  }, [opts]);

  const phrase = ACTION_COPY[opts.action || 'generic'];

  return (
    <SignupGateContext.Provider value={{ openGate }}>
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.glow} pointerEvents="none" />
            <TouchableOpacity style={styles.close} onPress={dismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>

            <View style={styles.seal}>
              <Ionicons name="ribbon-outline" size={26} color={GOLD} />
            </View>
            <Text style={styles.amo}>A · M · O</Text>
            <Text style={styles.title}>{tr('Crea tu cuenta gratis')}{'\n'}<Text style={styles.titleAccent}>{tr(phrase)}</Text></Text>

            <View style={styles.perks}>
              {[
                ['sparkles', 'Luna, tu concierge — sin límites'],
                ['ribbon', 'Tu pasaporte, sellos y títulos'],
                ['briefcase', 'Viajes que planeás con tu grupo'],
              ].map(([icon, label]) => (
                <View key={label} style={styles.perkRow}>
                  <Ionicons name={icon as any} size={15} color={GOLD} />
                  <Text style={styles.perkText}>{tr(label)}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.cta} onPress={proceed} activeOpacity={0.9}>
              <Text style={styles.ctaText}>{tr('Crear cuenta gratis')}</Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
            <Text style={styles.free}>{tr('Es gratis · toda la app se desbloquea al crear tu cuenta')}</Text>
            <TouchableOpacity style={styles.keepLooking} onPress={dismiss}>
              <Text style={styles.keepLookingText}>{tr('Seguir mirando')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SignupGateContext.Provider>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0C0C13', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 30, paddingHorizontal: SPACING.xl, paddingBottom: Platform.OS === 'web' ? 34 : 44,
    borderWidth: 1, borderColor: 'rgba(18,181,165,0.28)', overflow: 'hidden', alignItems: 'center',
  },
  glow: {
    position: 'absolute', top: -80, alignSelf: 'center', width: 340, height: 340, borderRadius: 170,
    backgroundColor: 'rgba(18,181,165,0.15)', ...(Platform.OS === 'web' ? { filter: 'blur(70px)' } as any : {}),
  },
  close: { position: 'absolute', top: 14, right: 16, zIndex: 5 },
  seal: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: 'rgba(18,181,165,0.5)',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  amo: { color: GOLD, fontSize: 12, letterSpacing: 6, fontFamily: Platform.select({ web: 'Georgia, serif', default: 'serif' }), marginBottom: 12 },
  title: {
    color: '#FFFFFF', fontSize: 25, textAlign: 'center', lineHeight: 32,
    fontFamily: Platform.select({ web: 'Georgia, serif', default: 'serif' }),
  },
  titleAccent: { color: GOLD_BRIGHT },
  perks: { alignSelf: 'stretch', gap: 11, marginTop: 24, marginBottom: 26 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  perkText: { color: 'rgba(255,255,255,0.82)', fontSize: 14.5 },
  cta: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 999, paddingVertical: 16,
  },
  ctaText: { color: '#0A0A0A', fontSize: 16, ...FONTS.bold },
  free: { color: COLORS.textMuted, fontSize: 12, marginTop: 12, textAlign: 'center' },
  keepLooking: { marginTop: 14, padding: 6 },
  keepLookingText: { color: COLORS.textMuted, fontSize: 14, ...FONTS.medium },
});
