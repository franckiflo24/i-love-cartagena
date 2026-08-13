import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useLang } from '../context/LanguageContext';

// First-run partner onboarding tour. Auto-opens ONCE per business (AsyncStorage
// flag keyed by business_id) the first time they reach the business area, and can
// be replayed from the dashboard's "?" button. Mirrors the shareable partner guide.
// Self-contained ES/EN (no dependency on the global auto-translate dictionary).

type Bi = { es: string; en: string };
type Step = { icon: keyof typeof Ionicons.glyphMap; title: Bi; body: Bi; tip?: Bi };

const STEPS: Step[] = [
  {
    icon: 'sparkles',
    title: { es: '¡Bienvenido a AMO!', en: 'Welcome to AMO!' },
    body: {
      es: 'Te mostramos en un minuto cómo poner tu negocio en la app. Puedes cerrar y volver cuando quieras.',
      en: 'A one-minute tour of how to set up your business on the app. You can close and come back anytime.',
    },
  },
  {
    icon: 'search',
    title: { es: 'Encuentra y reclama tu negocio', en: 'Find & claim your business' },
    body: {
      es: 'Busca tu negocio en el catálogo y toca «Reclamar». Casi seguro ya está en AMO.',
      en: 'Search the catalog and tap “Claim.” It’s very likely already on AMO.',
    },
    tip: {
      es: '¿No aparece? Toca «Crear un negocio nuevo» y el equipo lo revisa.',
      en: 'Not there? Tap “Create a new business” and the team reviews it.',
    },
  },
  {
    icon: 'mail-open',
    title: { es: 'Verifica que eres el dueño', en: 'Verify you’re the owner' },
    body: {
      es: 'Te llega un código de 6 dígitos al correo del negocio. Escríbelo y ¡listo, ya eres el dueño!',
      en: 'A 6-digit code arrives at the venue’s email. Type it in and you’re the verified owner!',
    },
    tip: {
      es: '¿Sin correo registrado o no te llega? Usa «Revisión manual» y el equipo te verifica a mano.',
      en: 'No email on file or none arrived? Use “Manual review” and the team verifies you by hand.',
    },
  },
  {
    icon: 'camera',
    title: { es: 'Sube tus fotos', en: 'Add your photos' },
    body: {
      es: 'En «Mi contenido» sube tus fotos. El equipo las aprueba y luego eliges tu foto principal — aparece en toda la app en calidad completa.',
      en: 'Upload photos in “My content.” The team approves them, then you pick your main photo — it shows across the whole app in full quality.',
    },
  },
  {
    icon: 'create',
    title: { es: 'Completa tu información', en: 'Complete your info' },
    body: {
      es: 'Edita tu descripción, horario, WhatsApp e Instagram desde «Editar perfil». Los cambios se ven al instante.',
      en: 'Edit your description, hours, WhatsApp and Instagram from “Edit profile.” Changes show instantly.',
    },
    tip: {
      es: 'El precio va aparte, en «Mi contenido» → «Envía un precio».',
      en: 'Pricing is separate, under “My content” → “Submit a price.”',
    },
  },
  {
    icon: 'chatbubble-ellipses',
    title: { es: '¿Dudas? Estamos contigo', en: 'Questions? We’ve got you' },
    body: {
      es: 'Cuando necesites ayuda, escríbele a tu contacto de AMO por WhatsApp. Nada se pierde: puedes seguir cuando quieras.',
      en: 'Whenever you need help, message your AMO contact on WhatsApp. Nothing is lost — pick up whenever you like.',
    },
  },
];

const flagKey = (id?: string) => `amo_biz_tour_seen_${id || 'anon'}`;

export default function BusinessOnboardingTour({
  businessId,
  enabled = true,
  forceOpen = false,
  onForceHandled,
}: {
  businessId?: string;
  enabled?: boolean;
  forceOpen?: boolean;
  onForceHandled?: () => void;
}) {
  const { lang } = useLang();
  const pick = (o: Bi) => (o as any)[lang] || o.en || o.es;
  const isEn = lang === 'en';

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const forcedRef = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;

  // First-run: auto-open once per business.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!enabled || !businessId) return;
      try {
        const seen = await AsyncStorage.getItem(flagKey(businessId));
        if (!seen && alive) {
          setStep(0);
          forcedRef.current = false;
          setTimeout(() => { if (alive) setVisible(true); }, 450);
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [enabled, businessId]);

  // Replay from the dashboard.
  useEffect(() => {
    if (forceOpen) { setStep(0); forcedRef.current = true; setVisible(true); }
  }, [forceOpen]);

  const animateTo = (nextStep: number) => {
    Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setStep(nextStep);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  const close = async () => {
    setVisible(false);
    try { if (businessId) await AsyncStorage.setItem(flagKey(businessId), '1'); } catch { /* ignore */ }
    if (forcedRef.current) { forcedRef.current = false; onForceHandled?.(); }
  };

  const next = () => { if (step < STEPS.length - 1) animateTo(step + 1); else close(); };
  const back = () => { if (step > 0) animateTo(step - 1); };

  if (!visible) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.glow} pointerEvents="none" />

          <TouchableOpacity style={styles.skip} onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>{isEn ? 'Skip' : 'Saltar'}</Text>
          </TouchableOpacity>

          <Animated.View style={{ opacity: fade, alignItems: 'center', width: '100%' }}>
            <View style={styles.iconWrap}>
              <Ionicons name={s.icon} size={32} color={COLORS.primary} />
            </View>
            <Text style={styles.eyebrow}>{isEn ? `STEP ${step + 1} OF ${STEPS.length}` : `PASO ${step + 1} DE ${STEPS.length}`}</Text>
            <Text style={styles.title}>{pick(s.title)}</Text>
            <Text style={styles.body}>{pick(s.body)}</Text>
            {s.tip ? (
              <View style={styles.tip}>
                <Ionicons name="bulb" size={15} color={COLORS.primary} style={{ marginTop: 1 }} />
                <Text style={styles.tipText}>{pick(s.tip)}</Text>
              </View>
            ) : null}
          </Animated.View>

          <View style={styles.dots}>
            {STEPS.map((_, i) => <View key={i} style={[styles.dot, i === step && styles.dotOn]} />)}
          </View>

          <View style={styles.nav}>
            <TouchableOpacity style={styles.backBtn} onPress={back} disabled={step === 0} accessibilityLabel={isEn ? 'Back' : 'Atrás'}>
              <Text style={[styles.backText, step === 0 && { opacity: 0 }]}>{isEn ? 'Back' : 'Atrás'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextBtn} onPress={next} activeOpacity={0.9}>
              <Text style={styles.nextText}>{last ? (isEn ? 'Got it!' : '¡Empezar!') : (isEn ? 'Next' : 'Siguiente')}</Text>
              {!last ? <Ionicons name="arrow-forward" size={17} color="#0A0A0A" /> : null}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  card: {
    width: '100%', maxWidth: 400, backgroundColor: '#0C0C13', borderRadius: 26, paddingTop: 34,
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)',
    overflow: 'hidden', alignItems: 'center',
  },
  glow: {
    position: 'absolute', top: -90, alignSelf: 'center', width: 320, height: 320, borderRadius: 160,
    backgroundColor: 'rgba(212,175,55,0.16)', ...(Platform.OS === 'web' ? ({ filter: 'blur(70px)' } as any) : {}),
  },
  skip: { position: 'absolute', top: 14, right: 16, zIndex: 5, padding: 4 },
  skipText: { color: COLORS.textMuted, fontSize: 13, ...FONTS.semibold },
  iconWrap: {
    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.14)', borderWidth: 1.5, borderColor: 'rgba(212,175,55,0.5)', marginBottom: 16,
  },
  eyebrow: { color: COLORS.primary, fontSize: 11, letterSpacing: 2.4, ...FONTS.bold, marginBottom: 10 },
  title: {
    color: COLORS.textMain, fontSize: 23, textAlign: 'center', lineHeight: 29, marginBottom: 10,
    fontFamily: Platform.select({ web: 'Georgia, serif', default: 'serif' }),
  },
  body: { color: 'rgba(255,255,255,0.78)', fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 2 },
  tip: {
    flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, backgroundColor: 'rgba(212,175,55,0.09)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.24)', borderRadius: 12, padding: 12,
  },
  tipText: { flex: 1, color: 'rgba(255,255,255,0.82)', fontSize: 13, lineHeight: 18 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 26, marginBottom: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotOn: { width: 20, backgroundColor: COLORS.primary },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  backBtn: { paddingVertical: 12, paddingHorizontal: 8, minWidth: 60 },
  backText: { color: COLORS.textMuted, fontSize: 15, ...FONTS.semibold },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: COLORS.primary,
    borderRadius: 999, paddingVertical: 13, paddingHorizontal: 26,
  },
  nextText: { color: '#0A0A0A', fontSize: 15, ...FONTS.bold },
});
