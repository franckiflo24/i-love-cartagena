// CMW-3 — /cmw: Cartagena Music Week presale pre-registration.
//
// ONE question per screen. Franck's spec asks for "pedir solo lo que falta, un
// toque" in under 30 seconds; an 11-field wall is the opposite of that, so the
// presentation is a guided flow while every load-bearing rail below stays exactly
// as the backend proved it (same payload, same validation source, same consents).
//
// Load-bearing rails (the backend enforces every one of them again):
//   - Core consent starts UNCHECKED and submit is blocked without it; it is a NEW
//     authorization every time (never remembered, never inferred from a session).
//     Marketing is a second, separate, optional authorization.
//   - 18+ hard gate client-side: an under-18 date of birth stops the flow on its
//     own step and sends NOTHING over the wire.
//   - The only presale promise on screen is notification priority — no inventory
//     guarantee, no "garantiza tu entrada", anywhere.
//   - Attribution (utm_* + ref) is captured silently and survives the login
//     round-trip (/login?next=/cmw); it is never shown as a public claim.
//   - validatePrereg (src/lib/cmwPrereg) stays the ONE client validation source,
//     mirroring the server — steps only decide WHEN each field is asked.
//   - The app nudge appears ONLY after a successful capture.
//
// Flow mechanics: `ALL` is the full step list; `skip` holds the steps a signed-in
// profile already answers, so an authed visitor walks the missing ones only. The
// recap on the last step can jump to ANY step (skipped ones included) and returns
// straight to the recap — the only way to edit a prefilled value. A server field
// error jumps to the step that owns that field.
//
// Animation uses RN's built-in Animated: react-native-reanimated is installed but
// unused repo-wide (its babel plugin is not configured), so Animated is the
// OTA-safe choice — no native module, identical on web and native.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from '../src/components/WebHead';
import { useAuth } from '../src/context/AuthContext';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';
import { api } from '../src/constants/api';
import { openExternal } from '../src/lib/cityModules';
import { goBackOr } from '../src/lib/nav';
import { hapticError, hapticLight, hapticSuccess } from '../src/lib/haptics';
import {
  CONSENT_TEXT_ES, CONSENT_VERSION, FIELD_ERROR_COPY, MARKETING_TEXT_ES, PRIORITY_LINE_ES,
  PreregFieldError, PreregGender, PreregResult, PreregSource, captureSource, dobIso, failureCopy,
  fireCmwEvent, prefillFrom, referralLink, referralShareText, submitPrereg, validatePrereg,
} from '../src/lib/cmwPrereg';
import { CMW, CMW_GRADIENT, CMW_GUTTER, CMW_RADIUS, CMW_SERIF, CMW_TYPE } from '../src/components/cmw/cmwTheme';
import { CmwButton, CmwWordmark } from '../src/components/cmw/CmwUI';

const APP_STORE_URL = 'https://apps.apple.com/app/id6809565354';
// RNW ignores the native driver and warns once per app; opacity/transform run on
// the UI thread on native only.
const NATIVE = Platform.OS !== 'web';

// English twins for the bilingual second line (same pattern as CmwRequestSheet).
const EN_LINE: Record<string, string> = {
  'Escribe tu nombre (2 a 80 caracteres).': 'Enter your name (2 to 80 characters).',
  'Escribe tu apellido (2 a 80 caracteres).': 'Enter your last name (2 to 80 characters).',
  'Escribe tu usuario de Instagram (sin @).': 'Enter your Instagram handle (no @).',
  'Escribe un correo válido.': 'Enter a valid email.',
  'Escribe un número de WhatsApp con indicativo.': 'Enter a WhatsApp number with country code.',
  'Escribe tu fecha de nacimiento completa (DD/MM/AAAA).': 'Enter your full date of birth (DD/MM/YYYY).',
  'La preinscripción es solo para mayores de 18 años.': 'Pre-registration is 18+ only.',
  'Marca la autorización de datos para continuar.': 'Tick the data authorization to continue.',
  'Demasiadas solicitudes. Intenta de nuevo en una hora.': 'Too many requests. Try again in an hour.',
  'Sin conexión. Revisa tu red e intenta de nuevo.': 'No connection. Check your network and try again.',
  'Revisa los datos e intenta de nuevo.': 'Check your details and try again.',
  'El texto de autorización cambió. Recarga la página e inténtalo de nuevo.': 'The consent text changed. Reload the page and try again.',
  'El servicio no está disponible en este momento. Intenta de nuevo.': 'The service is unavailable right now. Please try again.',
};

type Done = { preregId: string; updated: boolean; referralCode: string | null };

type StepKey = 'intro' | 'name' | 'email' | 'whatsapp' | 'dob' | 'instagram' | 'origin' | 'confirm';
const ALL: StepKey[] = ['intro', 'name', 'email', 'whatsapp', 'dob', 'instagram', 'origin', 'confirm'];

/** Which fields each step owns — the gate for "can I advance?" and the target of a
 *  server field error. validatePrereg stays the single source of the RULES. */
const STEP_FIELDS: Record<StepKey, PreregFieldError[]> = {
  intro: [],
  name: ['name', 'last_name'],
  email: ['email'],
  whatsapp: ['whatsapp'],
  dob: ['dob', 'under_18'],
  instagram: ['instagram'],
  origin: [],
  confirm: ['consent'],
};

const SERVER_FIELD: Record<string, PreregFieldError> = {
  invalid_name: 'name', invalid_last_name: 'last_name', invalid_email: 'email',
  invalid_whatsapp: 'whatsapp', invalid_instagram: 'instagram', invalid_dob: 'dob',
  under_18: 'under_18', consent_required: 'consent',
};

const stepOf = (f: PreregFieldError): StepKey =>
  (ALL.find((k) => STEP_FIELDS[k].includes(f)) || 'confirm');

const GENDER_OPTIONS: Array<{ value: PreregGender; label: string }> = [
  { value: 'femenino', label: 'Femenino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'otro', label: 'Otro' },
  { value: 'prefiero_no_decir', label: 'Prefiero no decir' },
];

function CheckRow({ checked, onToggle, children, testID }: {
  checked: boolean; onToggle: () => void; children: React.ReactNode; testID: string;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={s.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      testID={testID}
    >
      <View style={[s.checkBox, checked && s.checkBoxOn]}>
        {checked && <Ionicons name="checkmark" size={15} color={CMW.onAccent} />}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableOpacity>
  );
}

export default function CmwPreregScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<Record<string, string>>();
  const scrollRef = useRef<ScrollView>(null);

  // ── attribution: captured once, first touch wins across the login round-trip
  const [source, setSource] = useState<PreregSource | null>(null);
  useEffect(() => {
    let alive = true;
    captureSource(params).then((src) => {
      if (!alive) return;
      setSource(src);
      fireCmwEvent('cmw_link_abierto', src, lang); // spec funnel: the link worked
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // preinscripcion_iniciada: once, when they actually begin.
  const startedRef = useRef(false);
  const markStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    fireCmwEvent('preinscripcion_iniciada', source, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, lang]);

  // ── form state
  const [fullName, setFullName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [instagram, setInstagram] = useState('');
  const [gender, setGender] = useState<PreregGender | null>(null);
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [dobD, setDobD] = useState('');
  const [dobM, setDobM] = useState('');
  const [dobY, setDobY] = useState('');
  const [consentChecked, setConsentChecked] = useState(false); // ALWAYS starts unchecked
  const [marketingChecked, setMarketingChecked] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot — no person ever sees it
  const [errors, setErrors] = useState<PreregFieldError[]>([]);
  const [serverFail, setServerFail] = useState<Extract<PreregResult, { ok: false }> | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  // ── signed-in: prefill from the real profile and ask only for what's missing
  const [ask, setAsk] = useState(() => prefillFrom(null).ask);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!user?.user_id || hydrated.current) return;
    let alive = true;
    (async () => {
      let profile: Record<string, string> | null = null;
      try {
        profile = await api.get('/profile');
      } catch {
        profile = { name: user.name || '', email: user.email || '', phone: user.phone || '' };
      }
      if (!alive || hydrated.current) return;
      hydrated.current = true;
      const p = prefillFrom(profile);
      setFullName((v) => v || p.fullName);
      setEmail((v) => v || p.email);
      setWhatsapp((v) => v || p.whatsapp);
      setInstagram((v) => v || p.instagram);
      setCountry((v) => v || p.country);
      setAsk(p.ask);
    })();
    return () => { alive = false; };
  }, [user?.user_id, user?.name, user?.email, user?.phone]);

  // ── the step machine ────────────────────────────────────────────────────────
  const [idx, setIdx] = useState(0);                 // index into ALL
  const [skip, setSkip] = useState<Set<StepKey>>(new Set());
  const returnToConfirm = useRef(false);             // set when editing from the recap

  // What a signed-in profile already answers. Frozen once the visitor leaves the
  // intro, so a late /profile hydration can never reshuffle a flow in progress.
  const computedSkip = useMemo(() => {
    const out = new Set<StepKey>();
    if (user) {
      if (!ask.fullName) out.add('name');
      if (!ask.email) out.add('email');
      if (!ask.whatsapp) out.add('whatsapp');
      if (!ask.instagram) out.add('instagram');
    }
    return out;
  }, [user, ask]);

  useEffect(() => {
    if (idx !== 0) return;
    setSkip((prev) => {
      const a = [...prev].sort().join();
      const b = [...computedSkip].sort().join();
      return a === b ? prev : computedSkip;
    });
  }, [computedSkip, idx]);

  const current = ALL[idx];
  const live = useMemo(() => ALL.filter((k) => k !== 'intro' && !skip.has(k)), [skip]);
  const position = live.indexOf(current) + 1;        // 0 while on the intro

  const nextIdx = useCallback((from: number) => {
    for (let j = from + 1; j < ALL.length; j += 1) if (!skip.has(ALL[j])) return j;
    return from;
  }, [skip]);
  const prevIdx = useCallback((from: number) => {
    for (let j = from - 1; j >= 0; j -= 1) if (!skip.has(ALL[j])) return j;
    return from;
  }, [skip]);

  // ── motion ──────────────────────────────────────────────────────────────────
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const prog = useRef(new Animated.Value(0)).current;
  const aura = useRef(new Animated.Value(0)).current;
  const dir = useRef<1 | -1>(1);

  // Slow breathing glow behind the whole flow — the festival poster, alive.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(aura, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(aura, { toValue: 0, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [aura]);

  // Enter animation, every time the step changes (and on first paint).
  useEffect(() => {
    fade.setValue(0);
    slide.setValue(dir.current * 26);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
      Animated.timing(slide, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
    ]).start();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [idx, done, fade, slide]);

  useEffect(() => {
    Animated.timing(prog, {
      toValue: live.length ? Math.max(0, position) / live.length : 0,
      duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [position, live.length, prog]);

  /** Leave the current step, then land on `to`. One cross-fade, never a jump. */
  const travel = useCallback((to: number, d: 1 | -1) => {
    if (to === idx) return;
    dir.current = d;
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(slide, { toValue: -d * 18, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
    ]).start(() => setIdx(to));
  }, [idx, fade, slide]);

  const draft = useMemo(() => ({
    fullName, lastName, askLastName: !user || ask.fullName, email, whatsapp, instagram,
    dobD, dobM, dobY, consentChecked,
  }), [fullName, lastName, user, ask.fullName, email, whatsapp, instagram, dobD, dobM, dobY, consentChecked]);

  /** Advance — but only when THIS step's fields pass the shared validator. */
  const advance = useCallback(() => {
    markStarted();
    const owned = STEP_FIELDS[current];
    if (owned.length) {
      const problems = validatePrereg(draft).filter((f) => owned.includes(f));
      if (problems.length) {
        setErrors(problems);
        hapticError();
        return;
      }
    }
    setErrors([]);
    hapticLight();
    if (returnToConfirm.current) {
      returnToConfirm.current = false;
      travel(ALL.indexOf('confirm'), 1);
      return;
    }
    travel(nextIdx(idx), 1);
  }, [current, draft, idx, markStarted, nextIdx, travel]);

  const back = useCallback(() => {
    setErrors([]);
    if (returnToConfirm.current) {
      returnToConfirm.current = false;
      travel(ALL.indexOf('confirm'), -1);
      return;
    }
    if (idx === 0) { goBackOr(router, '/music-week'); return; }
    travel(prevIdx(idx), -1);
  }, [idx, prevIdx, router, travel]);

  /** Jump to any step — including one a profile normally skips (recap editing). */
  const editStep = useCallback((k: StepKey) => {
    returnToConfirm.current = true;
    setErrors([]);
    travel(ALL.indexOf(k), -1);
  }, [travel]);

  const has = (f: PreregFieldError) => errors.includes(f);
  const clearError = useCallback((f: PreregFieldError) => {
    setErrors((e) => (e.includes(f) ? e.filter((x) => x !== f) : e));
  }, []);
  const onField = useCallback(<T extends string>(set: (v: T) => void, err: PreregFieldError) =>
    (v: T) => { markStarted(); set(v); clearError(err); if (err === 'dob') clearError('under_18'); },
    [clearError, markStarted]);

  // Date of birth: three boxes that hand the caret along like a real date field.
  const dobM_ref = useRef<TextInput>(null);
  const dobY_ref = useRef<TextInput>(null);

  const errorLines = useMemo(() => {
    if (!serverFail) return null;
    const es = failureCopy(serverFail);
    return { primary: tr(es), secondary: lang === 'en' ? es : (EN_LINE[es] || es) };
  }, [serverFail, lang, tr]);

  const submit = useCallback(async () => {
    if (sending) return;
    setServerFail(null);
    const problems = validatePrereg(draft);
    if (problems.length) {
      // Land on the step that owns the first problem — never error at a field the
      // visitor cannot see.
      setErrors(problems);
      hapticError();
      travel(ALL.indexOf(stepOf(problems[0])), -1);
      return;
    }
    const iso = dobIso(dobD, dobM, dobY);
    if (!iso || !source) return;
    setSending(true);
    const askLastName = !user || ask.fullName;
    const joined = askLastName && lastName.trim() ? `${fullName.trim()} ${lastName.trim()}` : fullName.trim();
    const r = await submitPrereg({
      full_name: joined,
      last_name: lastName.trim() || undefined,
      email: email.trim(),
      whatsapp: whatsapp.trim(),
      instagram: instagram.trim().replace(/^@/, ''),
      gender: gender || undefined,
      city: city.trim() || undefined,
      country: country.trim() || undefined,
      dob: iso,
      lang,
      // The consent object exists ONLY because the box was ticked (validate above).
      consent: { accepted: true, version: CONSENT_VERSION },
      marketing_opt_in: marketingChecked,
      source,
      website,
    });
    setSending(false);
    if (r.ok) {
      hapticSuccess();
      setDone({ preregId: r.preregId, updated: r.updated, referralCode: r.referralCode });
      return;
    }
    hapticError();
    setServerFail(r);
    const f = r.code ? SERVER_FIELD[r.code] : undefined;
    if (f) {
      setErrors([f]);
      travel(ALL.indexOf(stepOf(f)), -1);
    }
  }, [sending, draft, dobD, dobM, dobY, source, user, ask.fullName, lastName, fullName, email,
      whatsapp, instagram, gender, city, country, lang, marketingChecked, website, travel]);

  const openPrivacy = useCallback(() => { router.push('/privacidad' as never); }, [router]);
  const goLogin = useCallback(() => {
    router.push({ pathname: '/login', params: { next: '/cmw' } } as never);
  }, [router]);

  // Referral share: native/web share sheet first (Share.share also drives
  // navigator.share on web); the WhatsApp button is the LATAM-first path.
  const [copied, setCopied] = useState(false);
  const shareReferral = useCallback(async (code: string, via: 'share' | 'whatsapp' | 'copy') => {
    const text = referralShareText(code, lang);
    fireCmwEvent('referido_compartido', source, lang);
    try {
      if (via === 'whatsapp') {
        await openExternal(`https://wa.me/?text=${encodeURIComponent(text)}`);
      } else if (via === 'copy' && Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(referralLink(code));
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        await Share.share({ message: text });
      }
    } catch {
      // user closed the sheet / clipboard denied — nothing to recover
    }
  }, [lang, source]);

  const auraOpacity = aura.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const progWidth = prog.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const stageStyle = { opacity: fade, transform: [{ translateX: slide }] };

  const missingCount = live.length;

  // ── step bodies ─────────────────────────────────────────────────────────────
  const Question = useCallback(
    ({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) => (
      <View style={s.qHead}>
        {!!eyebrow && <Text style={s.qEyebrow}>{tr(eyebrow)}</Text>}
        <Text style={s.qTitle}>{tr(title)}</Text>
        {!!hint && <Text style={s.qHint}>{tr(hint)}</Text>}
      </View>
    ), [tr]);

  const RecapRow = useCallback(
    ({ label, value, step }: { label: string; value: string; step: StepKey }) => {
      if (!value) return null;
      return (
        <View style={s.recapRow}>
          <Text style={s.recapLabel}>{tr(label)}</Text>
          <Text style={s.recapValue} numberOfLines={1}>{value}</Text>
          <TouchableOpacity onPress={() => editStep(step)} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID={`cmw-pre-edit-${step}`}>
            <Ionicons name="create-outline" size={16} color={CMW.amber} />
          </TouchableOpacity>
        </View>
      );
    }, [tr, editStep]);

  const renderStep = () => {
    switch (current) {
      case 'intro':
        return (
          <View>
            <CmwWordmark size="hero" align="left" />
            <Text style={s.heroEyebrow}>{tr('31 dic 2026 — 7 ene 2027 · Cartagena de Indias')}</Text>
            <Text style={[CMW_TYPE.title, { marginTop: 16 }]} testID="cmw-pre-title">{tr('Preinscríbete a la preventa')}</Text>
            <Text style={[CMW_TYPE.body, { marginTop: 8 }]} testID="cmw-pre-priority">{tr(PRIORITY_LINE_ES)}</Text>

            <View style={s.introMetaRow}>
              <View style={s.introMeta}>
                <Ionicons name="time-outline" size={14} color={CMW.amber} />
                <Text style={s.introMetaText}>{tr('Menos de 1 minuto')}</Text>
              </View>
              <View style={s.introMeta}>
                <Ionicons name="shield-checkmark-outline" size={14} color={CMW.amber} />
                <Text style={s.introMetaText}>{tr('Datos protegidos')}</Text>
              </View>
            </View>

            {user ? (
              <View style={s.authedBox} testID="cmw-pre-authed">
                <Ionicons name="person-circle-outline" size={18} color={CMW.amber} />
                <Text style={[CMW_TYPE.small, { flex: 1, color: CMW.sand }]}>
                  {missingCount <= 3
                    ? `${tr('Usaremos los datos de tu cuenta.')} ${tr('Solo faltan')} ${missingCount}.`
                    : tr('Usaremos los datos de tu cuenta. Solo te pedimos lo que falta.')}
                </Text>
              </View>
            ) : (
              !authLoading && (
                <TouchableOpacity onPress={goLogin} style={s.loginRow} accessibilityRole="button" testID="cmw-pre-login">
                  <Ionicons name="log-in-outline" size={16} color={CMW.amber} />
                  <Text style={s.loginText}>{tr('¿Ya tienes cuenta AMO?')} <Text style={{ color: CMW.amber, fontWeight: '700' }}>{tr('Iniciar sesión')}</Text></Text>
                </TouchableOpacity>
              )
            )}

            <CmwButton
              label={tr('Preinscribirme')}
              iconRight="arrow-forward"
              onPress={advance}
              style={{ marginTop: 22 }}
              testID="cmw-pre-start"
            />
            <Text style={[CMW_TYPE.small, { marginTop: 12 }]}>{tr('Preinscripción gestionada por AMO.')}</Text>
          </View>
        );

      case 'name':
        return (
          <View>
            <Question eyebrow="Tu nombre" title="¿Cómo te llamas?" hint="Como aparece en tu documento." />
            <TextInput
              value={fullName} onChangeText={onField(setFullName, 'name')}
              placeholder={tr('Nombre')} placeholderTextColor={CMW.sandFaint}
              autoCapitalize="words" autoComplete="name-given" textContentType="givenName" maxLength={80}
              autoFocus returnKeyType="next" blurOnSubmit={false}
              style={[s.input, has('name') && s.inputError]} testID="cmw-pre-name"
            />
            {has('name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.name)}</Text>}
            <TextInput
              value={lastName} onChangeText={onField(setLastName, 'last_name')}
              placeholder={tr('Apellidos')} placeholderTextColor={CMW.sandFaint}
              autoCapitalize="words" autoComplete="name-family" textContentType="familyName" maxLength={80}
              returnKeyType="done" onSubmitEditing={advance}
              style={[s.input, { marginTop: 12 }, has('last_name') && s.inputError]} testID="cmw-pre-lastname"
            />
            {has('last_name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.last_name)}</Text>}
          </View>
        );

      case 'email':
        return (
          <View>
            <Question eyebrow="Tu correo" title="¿A qué correo te avisamos?" hint="Ahí llega el aviso de la preventa." />
            <TextInput
              value={email} onChangeText={onField(setEmail, 'email')}
              placeholder="tu@correo.com" placeholderTextColor={CMW.sandFaint}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              autoComplete="email" textContentType="emailAddress" maxLength={254}
              autoFocus returnKeyType="done" onSubmitEditing={advance}
              style={[s.input, has('email') && s.inputError]} testID="cmw-pre-email"
            />
            {has('email') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.email)}</Text>}
          </View>
        );

      case 'whatsapp':
        return (
          <View>
            <Question eyebrow="WhatsApp" title="¿Cuál es tu WhatsApp?" hint="Con indicativo del país. Ej: +57 300 123 4567" />
            <TextInput
              value={whatsapp} onChangeText={onField(setWhatsapp, 'whatsapp')}
              placeholder="+57 300 123 4567" placeholderTextColor={CMW.sandFaint}
              keyboardType="phone-pad" autoCapitalize="none" autoCorrect={false}
              autoComplete="tel" textContentType="telephoneNumber" maxLength={24}
              autoFocus returnKeyType="done" onSubmitEditing={advance}
              style={[s.input, has('whatsapp') && s.inputError]} testID="cmw-pre-whatsapp"
            />
            {has('whatsapp') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.whatsapp)}</Text>}
          </View>
        );

      case 'dob':
        return (
          <View>
            <Question eyebrow="Fecha de nacimiento" title="¿Cuándo naciste?" hint="La preventa es solo para mayores de 18 años." />
            <View style={s.dobRow} testID="cmw-pre-dob">
              <TextInput
                value={dobD}
                onChangeText={(v) => { onField(setDobD, 'dob')(v); if (v.length === 2) dobM_ref.current?.focus(); }}
                placeholder="DD" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={2} autoFocus
                style={[s.input, s.dobBox, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-d"
              />
              <TextInput
                ref={dobM_ref} value={dobM}
                onChangeText={(v) => { onField(setDobM, 'dob')(v); if (v.length === 2) dobY_ref.current?.focus(); }}
                placeholder="MM" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={2}
                style={[s.input, s.dobBox, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-m"
              />
              <TextInput
                ref={dobY_ref} value={dobY} onChangeText={onField(setDobY, 'dob')}
                placeholder="AAAA" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={4} returnKeyType="done" onSubmitEditing={advance}
                style={[s.input, s.dobYear, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-y"
              />
            </View>
            {has('dob') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.dob)}</Text>}
            {has('under_18') && (
              <View style={s.under18Box} testID="cmw-pre-under18">
                <Ionicons name="hand-left-outline" size={16} color={CMW.coral} />
                <Text style={[s.fieldError, { marginTop: 0, flex: 1 }]}>{tr(FIELD_ERROR_COPY.under_18)}</Text>
              </View>
            )}
          </View>
        );

      case 'instagram':
        return (
          <View>
            <Question eyebrow="Instagram" title="¿Cuál es tu Instagram?" hint="Así te reconocemos y te compartimos el line-up." />
            <View style={s.igWrap}>
              <Text style={s.igAt}>@</Text>
              <TextInput
                value={instagram} onChangeText={onField(setInstagram, 'instagram')}
                placeholder="usuario" placeholderTextColor={CMW.sandFaint}
                autoCapitalize="none" autoCorrect={false} maxLength={31}
                autoFocus returnKeyType="done" onSubmitEditing={advance}
                style={[s.input, s.igInput, has('instagram') && s.inputError]} testID="cmw-pre-instagram"
              />
            </View>
            {has('instagram') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.instagram)}</Text>}
          </View>
        );

      case 'origin':
        return (
          <View>
            <Question eyebrow="De dónde vienes" title="¿Desde dónde nos visitas?" hint="Nos ayuda a organizar la preventa. Opcional." />
            <View style={s.placeRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{tr('Ciudad')}</Text>
                <TextInput
                  value={city} onChangeText={(v) => { markStarted(); setCity(v); }}
                  placeholder={tr('Ciudad')} placeholderTextColor={CMW.sandFaint}
                  autoCapitalize="words" maxLength={60} autoFocus
                  style={s.input} testID="cmw-pre-city"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{tr('País')}</Text>
                <TextInput
                  value={country} onChangeText={(v) => { markStarted(); setCountry(v); }}
                  placeholder={tr('País')} placeholderTextColor={CMW.sandFaint}
                  autoCapitalize="words" maxLength={60} returnKeyType="done" onSubmitEditing={advance}
                  style={s.input} testID="cmw-pre-country"
                />
              </View>
            </View>

            <Text style={[s.label, { marginTop: 20 }]}>{tr('Género')} <Text style={s.optional}>· {tr('opcional')}</Text></Text>
            <View style={s.genderRow} testID="cmw-pre-gender">
              {GENDER_OPTIONS.map((g) => {
                const active = gender === g.value;
                return (
                  <TouchableOpacity
                    key={g.value}
                    onPress={() => { markStarted(); hapticLight(); setGender(active ? null : g.value); }}
                    style={[s.genderChip, active && s.genderChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`cmw-pre-gender-${g.value}`}
                  >
                    <Text style={[s.genderChipText, active && s.genderChipTextOn]}>{tr(g.label)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 'confirm':
      default:
        return (
          <View>
            <Question eyebrow="Último paso" title="Revisa y confirma" />

            <View style={s.recapCard}>
              <RecapRow label="Nombre" value={[fullName, lastName].filter(Boolean).join(' ')} step="name" />
              <RecapRow label="Correo" value={email} step="email" />
              <RecapRow label="WhatsApp" value={whatsapp} step="whatsapp" />
              <RecapRow label="Instagram" value={instagram ? `@${instagram.replace(/^@/, '')}` : ''} step="instagram" />
              <RecapRow label="Nacimiento" value={dobD && dobM && dobY ? `${dobD}/${dobM}/${dobY}` : ''} step="dob" />
              <RecapRow label="Ciudad" value={[city, country].filter(Boolean).join(', ')} step="origin" />
            </View>

            <CheckRow checked={consentChecked} onToggle={() => { hapticLight(); setConsentChecked((v) => !v); clearError('consent'); }} testID="cmw-pre-consent">
              <Text style={s.consentText}>{tr(CONSENT_TEXT_ES)}</Text>
              <TouchableOpacity onPress={openPrivacy} style={s.consentLinkBtn} accessibilityRole="link" testID="cmw-pre-privacy">
                <Ionicons name="shield-checkmark-outline" size={14} color={CMW.amber} />
                <Text style={s.consentLink}>{tr('Política de privacidad')}</Text>
              </TouchableOpacity>
            </CheckRow>
            {has('consent') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.consent)}</Text>}

            <CheckRow checked={marketingChecked} onToggle={() => { hapticLight(); setMarketingChecked((v) => !v); }} testID="cmw-pre-marketing">
              <Text style={s.consentText}>{tr(MARKETING_TEXT_ES)} <Text style={s.optional}>({tr('opcional')})</Text></Text>
            </CheckRow>
          </View>
        );
    }
  };

  // ── success ─────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <Head>
          <title>Preinscripción recibida — Cartagena Music Week | AMO</title>
        </Head>
        <Aura opacity={auraOpacity} />
        <ScrollView ref={scrollRef} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={stageStyle}>
            <View style={s.successWrap} testID="cmw-pre-success">
              <View style={s.successRing}>
                <LinearGradient colors={[...CMW_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.successDisc}>
                  <Ionicons name="checkmark" size={30} color={CMW.onAccent} />
                </LinearGradient>
              </View>
              <Text style={[CMW_TYPE.title, { textAlign: 'center', marginTop: 18 }]}>{tr('Estás en la lista')}</Text>
              {done.updated && (
                <Text style={[CMW_TYPE.body, { textAlign: 'center', marginTop: 6 }]} testID="cmw-pre-updated">
                  {tr('Ya estabas en la lista: actualizamos tus datos.')}
                </Text>
              )}
              <Text style={[CMW_TYPE.body, { textAlign: 'center', marginTop: 8 }]}>{tr(PRIORITY_LINE_ES)}</Text>

              <View style={s.rid}>
                <Text style={s.ridLabel}>{tr('Número de preinscripción')}</Text>
                <Text style={s.ridValue} selectable testID="cmw-pre-id">{done.preregId}</Text>
              </View>

              {!!done.referralCode && (
                <View style={s.referralBox} testID="cmw-pre-referral">
                  <Text style={[CMW_TYPE.h3, { textAlign: 'center' }]}>{tr('Invita a tus amigos')}</Text>
                  <Text style={[CMW_TYPE.small, { marginTop: 6, textAlign: 'center' }]}>
                    {tr('Comparte tu enlace: quien se preinscriba contigo también recibe el aviso de preventa primero.')}
                  </Text>
                  <View style={s.refCodeRow}>
                    <Text style={s.refCode} selectable testID="cmw-pre-refcode">{done.referralCode}</Text>
                  </View>
                  <View style={s.refBtnRow}>
                    {/* The system share sheet only exists on native / web-with-navigator.share:
                        a dead button teaches people the screen is broken. */}
                    {(Platform.OS !== 'web'
                      || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')) && (
                      <CmwButton label={tr('Compartir')} icon="share-social-outline"
                        onPress={() => shareReferral(done.referralCode as string, 'share')}
                        style={{ flex: 1 }} testID="cmw-pre-share" />
                    )}
                    <CmwButton label="WhatsApp" variant="secondary" icon="logo-whatsapp"
                      onPress={() => shareReferral(done.referralCode as string, 'whatsapp')}
                      style={{ flex: 1 }} testID="cmw-pre-share-wa" />
                  </View>
                  {Platform.OS === 'web' && (
                    <TouchableOpacity onPress={() => shareReferral(done.referralCode as string, 'copy')}
                      style={s.copyRow} accessibilityRole="button" testID="cmw-pre-copy">
                      <Ionicons name={copied ? 'checkmark-circle-outline' : 'copy-outline'} size={14} color={CMW.amber} />
                      <Text style={s.copyText}>{copied ? tr('Enlace copiado') : tr('Copiar enlace')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {Platform.OS === 'web' && (
                <View style={s.nudge} testID="cmw-pre-nudge">
                  <Text style={[CMW_TYPE.h3, { fontSize: 18, lineHeight: 23 }]}>{tr('Termina tu perfil en la app AMO')}</Text>
                  <Text style={[CMW_TYPE.small, { marginTop: 4 }]}>
                    {tr('El programa, tus solicitudes al concierge y el aviso de preventa, todo en un solo lugar.')}
                  </Text>
                  <CmwButton label={tr('Descargar en el App Store')} icon="logo-apple" onPress={() => openExternal(APP_STORE_URL)} style={{ marginTop: 12 }} testID="cmw-pre-appstore" />
                </View>
              )}
              <CmwButton label={tr('Ver programa')} variant="secondary" icon="calendar-outline" onPress={() => router.push('/music-week' as never)} style={{ marginTop: 12 }} testID="cmw-pre-program" />
              <CmwButton label={tr('Volver al inicio')} variant="ghost" onPress={() => router.replace('/(tabs)' as never)} style={{ marginTop: 4 }} />
            </View>
          </Animated.View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── the flow ────────────────────────────────────────────────────────────────
  const isIntro = current === 'intro';
  const isConfirm = current === 'confirm';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Head>
        <title>Preinscripción — Cartagena Music Week | AMO</title>
        <meta
          name="description"
          content="Preinscríbete a la preventa de Cartagena Music Week (31 dic 2026 – 7 ene 2027). Los preinscritos reciben el aviso de la preventa antes que el público general."
        />
      </Head>
      <Aura opacity={auraOpacity} />

      {/* ── header: back, compact wordmark, progress ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={back}
          style={s.navBtn}
          accessibilityRole="button"
          accessibilityLabel={tr('Volver')}
          testID="cmw-pre-back"
        >
          <Ionicons name={isIntro ? 'arrow-back' : 'chevron-back'} size={20} color={CMW.cream} />
        </TouchableOpacity>
        {!isIntro && (
          <View style={s.headerMid}>
            <Text style={s.headerMark}>CARTAGENA MUSIC WEEK</Text>
            <Text style={s.headerStep}>{position} {tr('de')} {live.length}</Text>
          </View>
        )}
      </View>

      {!isIntro && (
        <View style={s.progressTrack} testID="cmw-pre-progress">
          <Animated.View style={[s.progressFill, { width: progWidth }]}>
            <LinearGradient colors={[...CMW_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {errorLines && (
            <View style={s.errorBox} testID="cmw-pre-error" accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={18} color={CMW.coral} />
              <View style={{ flex: 1 }}>
                <Text style={s.errorText}>{errorLines.primary}</Text>
                <Text style={s.errorTextSecond}>{errorLines.secondary}</Text>
              </View>
            </View>
          )}

          {/* The intro is a poster: centre it. Question steps stay top-aligned so
              the field never moves when the keyboard opens. */}
          <Animated.View style={[s.stage, isIntro && s.stageCentered, stageStyle]}>{renderStep()}</Animated.View>

          {/* Honeypot: off-screen, hidden from assistive tech and the tab order.
              Mounted on every step so a bot always has it to fill. */}
          <TextInput value={website} onChangeText={setWebsite} style={s.honeypot} autoComplete="off" autoCorrect={false}
            tabIndex={-1} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" editable testID="cmw-pre-website" />

          {!isIntro && (
            <View style={s.footer}>
              {isConfirm ? (
                <CmwButton
                  label={sending ? tr('Enviando…') : tr('Confirmar preinscripción')}
                  icon={sending ? undefined : 'musical-notes-outline'}
                  onPress={submit}
                  loading={sending}
                  disabled={!consentChecked}
                  testID="cmw-pre-submit"
                />
              ) : (
                <CmwButton label={tr('Continuar')} iconRight="arrow-forward" onPress={advance} testID="cmw-pre-next" />
              )}
              {authLoading && <ActivityIndicator size="small" color={CMW.amber} style={{ marginTop: 10 }} />}
            </View>
          )}

          <View style={{ height: 36 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The festival glow: a soft sunset wash that breathes behind the whole flow.
 *  It fills the screen and fades to transparent well before the bottom — a
 *  fixed-height container left a visible horizontal seam where it ended. */
function Aura({ opacity }: { opacity: Animated.AnimatedInterpolation<number> }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <LinearGradient
        colors={['rgba(244,164,58,0.20)', 'rgba(238,107,77,0.07)', 'transparent']}
        locations={[0, 0.22, 0.52]}
        start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CMW.background },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: CMW_GUTTER, paddingTop: 10, paddingBottom: 8, maxWidth: 640, width: '100%', alignSelf: 'center' },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.line, alignItems: 'center', justifyContent: 'center' },
  headerMid: { flex: 1 },
  headerMark: { fontSize: 9.5, lineHeight: 13, fontWeight: '700', letterSpacing: 2.4, color: CMW.sandFaint },
  headerStep: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: CMW.sand, marginTop: 2 },

  progressTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.08)', maxWidth: 640, width: '100%', alignSelf: 'center' },
  progressFill: { height: 2, overflow: 'hidden' },

  scroll: { paddingHorizontal: CMW_GUTTER, paddingTop: 20, paddingBottom: 24, maxWidth: 640, width: '100%', alignSelf: 'center', flexGrow: 1 },
  stage: { flexGrow: 1 },
  stageCentered: { justifyContent: 'center', paddingBottom: 40 },

  heroEyebrow: { ...CMW_TYPE.eyebrow, marginTop: 12 },
  introMetaRow: { flexDirection: 'row', gap: 16, marginTop: 20, flexWrap: 'wrap' },
  introMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  introMetaText: { fontSize: 12.5, fontWeight: '600', color: CMW.sand },

  qHead: { marginBottom: 22 },
  qEyebrow: { ...CMW_TYPE.eyebrow, marginBottom: 10 },
  qTitle: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 32, lineHeight: 38, letterSpacing: 0.2, color: CMW.white },
  qHint: { ...CMW_TYPE.body, marginTop: 10 },

  loginRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, marginTop: 22 },
  loginText: { ...CMW_TYPE.small, color: CMW.sand, flex: 1 },
  authedBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, marginTop: 22 },

  label: { ...CMW_TYPE.eyebrow, color: CMW.sand, marginBottom: 8 },
  optional: { ...CMW_TYPE.small, textTransform: 'none', letterSpacing: 0, color: CMW.sandFaint },
  input: {
    minHeight: 56, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, color: CMW.white,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  inputError: { borderColor: CMW.coral },
  fieldError: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.coral, marginTop: 8 },

  dobRow: { flexDirection: 'row', gap: 10 },
  dobBox: { width: 76, textAlign: 'center' },
  dobYear: { width: 104, textAlign: 'center' },
  under18Box: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 14, backgroundColor: 'rgba(238,107,77,0.10)', borderWidth: 1, borderColor: 'rgba(238,107,77,0.45)', marginTop: 12 },

  igWrap: { flexDirection: 'row', alignItems: 'center' },
  igAt: { fontFamily: CMW_SERIF, fontSize: 26, color: CMW.amber, marginRight: 10 },
  igInput: { flex: 1 },

  placeRow: { flexDirection: 'row', gap: 12 },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genderChip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)', minHeight: 44, justifyContent: 'center' },
  genderChipOn: { backgroundColor: 'rgba(244,164,58,0.16)', borderColor: CMW.amber },
  genderChipText: { fontSize: 13.5, fontWeight: '600', color: CMW.sand },
  genderChipTextOn: { color: CMW.amber },

  recapCard: { borderRadius: CMW_RADIUS.card, borderWidth: 1, borderColor: CMW.line, backgroundColor: CMW.surface, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 18 },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: CMW.lineSoft },
  recapLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: CMW.sandFaint, width: 92 },
  recapValue: { flex: 1, fontSize: 14.5, fontWeight: '500', color: CMW.cream },

  honeypot: { position: 'absolute', left: -10000, top: 0, width: 1, height: 1, opacity: 0 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14, minHeight: 44 },
  checkBox: { width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkBoxOn: { backgroundColor: CMW.amber, borderColor: CMW.amber },
  consentText: { fontSize: 12.5, lineHeight: 18, fontWeight: '400', color: CMW.sand },
  consentLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32, paddingRight: 8, marginTop: 4 },
  consentLink: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  footer: { marginTop: 26 },

  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: 'rgba(238,107,77,0.10)', borderWidth: 1, borderColor: 'rgba(238,107,77,0.45)', marginBottom: 16 },
  errorText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: CMW.cream },
  errorTextSecond: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.sand, marginTop: 4 },

  successWrap: { alignItems: 'stretch', paddingTop: 10 },
  successRing: { width: 84, height: 84, borderRadius: 42, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CMW.line, backgroundColor: 'rgba(244,164,58,0.08)' },
  successDisc: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  rid: { alignItems: 'center', marginTop: 20, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
  ridLabel: { ...CMW_TYPE.eyebrow, color: CMW.sandFaint },
  ridValue: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 1.5, color: CMW.gold, marginTop: 4, fontVariant: ['tabular-nums'] },

  referralBox: { marginTop: 16, padding: 16, borderRadius: CMW_RADIUS.card, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
  refCodeRow: { alignItems: 'center', marginTop: 14, marginBottom: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: CMW.lineSoft },
  refCode: { fontFamily: CMW_SERIF, fontSize: 26, lineHeight: 32, letterSpacing: 3, color: CMW.gold },
  refBtnRow: { flexDirection: 'row', gap: 8 },
  copyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, minHeight: 32 },
  copyText: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  nudge: { marginTop: 18, padding: 16, borderRadius: CMW_RADIUS.card, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
});
