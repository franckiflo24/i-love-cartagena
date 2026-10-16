// CMW-1 — /cmw: Cartagena Music Week presale pre-registration. ONE route, two
// front doors: the anonymous web form (capture on the FIRST screen — never gated
// behind a download or a login) and the signed-in screen that asks only for what
// the profile is missing. Both submit to POST /cmw/prereg (backend/cmw_prereg.py).
//
// Load-bearing rails (the backend enforces every one of them again):
//   - Core consent checkbox starts UNCHECKED and submit is blocked without it; it
//     is a NEW authorization every time (never remembered, never inferred from a
//     session). Marketing is a second, separate, optional checkbox.
//   - 18+ hard gate client-side: an under-18 DOB shows a clear message and sends
//     NOTHING over the wire.
//   - The only presale promise on screen is notification priority — no inventory
//     guarantee, no "garantiza tu entrada", anywhere.
//   - Attribution (utm_* + ref) is captured silently and survives the login
//     round-trip (/login?next=/cmw); it is never shown as a public claim.
//   - The app nudge appears ONLY after a successful capture.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from '../src/components/WebHead';
import { useAuth } from '../src/context/AuthContext';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';
import { api } from '../src/constants/api';
import { openExternal } from '../src/lib/cityModules';
import {
  CONSENT_TEXT_ES, CONSENT_VERSION, FIELD_ERROR_COPY, MARKETING_TEXT_ES, PRIORITY_LINE_ES,
  PreregFieldError, PreregGender, PreregResult, PreregSource, captureSource, dobIso, failureCopy,
  fireCmwEvent, prefillFrom, referralLink, referralShareText, submitPrereg, validatePrereg,
} from '../src/lib/cmwPrereg';
import { CMW, CMW_GUTTER, CMW_RADIUS, CMW_TYPE } from '../src/components/cmw/cmwTheme';
import { CmwButton, CmwWordmark } from '../src/components/cmw/CmwUI';

const APP_STORE_URL = 'https://apps.apple.com/app/id6809565354';

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

  // preinscripcion_iniciada: once, on the first real interaction with the form.
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
  const [showAll, setShowAll] = useState(false);
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

  const has = (f: PreregFieldError) => errors.includes(f);
  const clearError = useCallback((f: PreregFieldError) => {
    setErrors((e) => (e.includes(f) ? e.filter((x) => x !== f) : e));
  }, []);

  const onField = useCallback(<T extends string>(set: (v: T) => void, err: PreregFieldError) =>
    (v: T) => { markStarted(); set(v); clearError(err); if (err === 'dob') clearError('under_18'); },
    [clearError, markStarted]);

  const errorLines = useMemo(() => {
    if (!serverFail) return null;
    const es = failureCopy(serverFail);
    return { primary: tr(es), secondary: lang === 'en' ? es : (EN_LINE[es] || es) };
  }, [serverFail, lang, tr]);

  const submit = useCallback(async () => {
    if (sending) return;
    setServerFail(null);
    // Apellido is demanded only when the form is actually collecting the name
    // (anonymous, or a profile with no name on file): a signed-in profile with a
    // combined name is never forced to split it retroactively.
    const askLastName = !user || ask.fullName;
    const problems = validatePrereg({
      fullName, lastName, askLastName, email, whatsapp, instagram, dobD, dobM, dobY, consentChecked,
    });
    setErrors(problems);
    if (problems.length) {
      // A signed-in profile can prefill an INVALID value into a hidden input (e.g. a
      // URL stored as instagram). Reveal the fields so the inline error is fixable —
      // otherwise the screen errors at a field the person cannot see.
      if (user && !showAll) setShowAll(true);
      return; // blocked client-side: nothing goes over the wire
    }
    const iso = dobIso(dobD, dobM, dobY);
    if (!iso || !source) return;
    setSending(true);
    const joinedName = askLastName && lastName.trim()
      ? `${fullName.trim()} ${lastName.trim()}` : fullName.trim();
    const r = await submitPrereg({
      full_name: joinedName,
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
      setDone({ preregId: r.preregId, updated: r.updated, referralCode: r.referralCode });
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 30);
    } else {
      setServerFail(r);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 30);
    }
  }, [sending, fullName, lastName, email, whatsapp, instagram, gender, city, country,
      dobD, dobM, dobY, consentChecked, marketingChecked, website, source, lang,
      user, ask.fullName, showAll]);

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

  const authedChips = useMemo(() => {
    if (!user) return [];
    const chips: Array<{ icon: string; value: string }> = [];
    if (!ask.fullName && fullName) chips.push({ icon: 'person-outline', value: fullName });
    if (!ask.email && email) chips.push({ icon: 'mail-outline', value: email });
    if (!ask.whatsapp && whatsapp) chips.push({ icon: 'logo-whatsapp', value: whatsapp });
    if (!ask.country && country) chips.push({ icon: 'flag-outline', value: country });
    if (!ask.instagram && instagram) chips.push({ icon: 'logo-instagram', value: `@${instagram}` });
    return chips;
  }, [user, ask, fullName, email, whatsapp, country, instagram]);

  const show = (k: keyof typeof ask): boolean => !user || showAll || ask[k];

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Head>
        <title>Preinscripción — Cartagena Music Week | AMO</title>
        <meta
          name="description"
          content="Preinscríbete a la preventa de Cartagena Music Week (31 dic 2026 – 7 ene 2027). Los preinscritos reciben el aviso de la preventa antes que el público general."
        />
      </Head>

      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* ── hero ── */}
        <View style={s.hero}>
          <CmwWordmark size="hero" align="left" />
          <Text style={s.heroEyebrow}>{tr('31 dic 2026 — 7 ene 2027 · Cartagena de Indias')}</Text>
          <Text style={[CMW_TYPE.h3, { marginTop: 14 }]} testID="cmw-pre-title">{tr('Preinscríbete a la preventa')}</Text>
          <Text style={[CMW_TYPE.body, { marginTop: 6 }]} testID="cmw-pre-priority">{tr(PRIORITY_LINE_ES)}</Text>
          <Text style={[CMW_TYPE.small, { marginTop: 8 }]}>{tr('Preinscripción gestionada por AMO.')}</Text>
        </View>

        {done ? (
          /* ── success: capture confirmed, THEN (and only then) the app nudge ── */
          <View style={s.card} testID="cmw-pre-success">
            <View style={s.successIcon}><Ionicons name="checkmark" size={28} color={CMW.onAccent} /></View>
            <Text style={[CMW_TYPE.h2, { textAlign: 'center' }]}>{tr('Preinscripción recibida')}</Text>
            {done.updated && (
              <Text style={[CMW_TYPE.body, { textAlign: 'center', marginTop: 6 }]} testID="cmw-pre-updated">
                {tr('Ya estabas en la lista: actualizamos tus datos.')}
              </Text>
            )}
            <Text style={[CMW_TYPE.body, { textAlign: 'center', marginTop: 6 }]}>{tr(PRIORITY_LINE_ES)}</Text>
            <View style={s.rid}>
              <Text style={s.ridLabel}>{tr('Número de preinscripción')}</Text>
              <Text style={s.ridValue} selectable testID="cmw-pre-id">{done.preregId}</Text>
            </View>
            <Text style={[CMW_TYPE.small, { textAlign: 'center' }]}>{tr('Guarda este número por si necesitas seguimiento.')}</Text>

            {/* CMW-2: the referral loop — your code, your link, shared where LATAM shares. */}
            {!!done.referralCode && (
              <View style={s.referralBox} testID="cmw-pre-referral">
                <Text style={[CMW_TYPE.h3, { fontSize: 18, lineHeight: 23 }]}>{tr('Invita a tus amigos')}</Text>
                <Text style={[CMW_TYPE.small, { marginTop: 4 }]}>
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
            <CmwButton label={tr('Ver programa')} variant="secondary" icon="calendar-outline" onPress={() => router.push('/music-week' as never)} style={{ marginTop: 10 }} testID="cmw-pre-program" />
            <CmwButton label={tr('Volver al inicio')} variant="ghost" onPress={() => router.replace('/(tabs)' as never)} style={{ marginTop: 4 }} />
          </View>
        ) : (
          <View style={s.card}>
            {errorLines && (
              <View style={s.errorBox} testID="cmw-pre-error" accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={18} color={CMW.coral} />
                <View style={{ flex: 1 }}>
                  <Text style={s.errorText}>{errorLines.primary}</Text>
                  <Text style={s.errorTextSecond}>{errorLines.secondary}</Text>
                </View>
              </View>
            )}

            {/* signed-in: what we already have on file; anonymous: a login shortcut */}
            {user ? (
              <View style={s.authedBox} testID="cmw-pre-authed">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="person-circle-outline" size={18} color={CMW.amber} />
                  <Text style={[CMW_TYPE.small, { flex: 1 }]}>{tr('Usaremos estos datos de tu cuenta. Solo te pedimos lo que falta.')}</Text>
                  {!showAll && authedChips.length > 0 && (
                    <TouchableOpacity onPress={() => setShowAll(true)} accessibilityRole="button" testID="cmw-pre-edit">
                      <Text style={s.editLink}>{tr('Editar')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {authedChips.length > 0 && (
                  <View style={s.chipWrap}>
                    {authedChips.map((c) => (
                      <View key={c.icon + c.value} style={s.chip}>
                        <Ionicons name={c.icon as never} size={12} color={CMW.sand} />
                        <Text style={s.chipText} numberOfLines={1}>{c.value}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              !authLoading && (
                <TouchableOpacity onPress={goLogin} style={s.loginRow} accessibilityRole="button" testID="cmw-pre-login">
                  <Ionicons name="log-in-outline" size={16} color={CMW.amber} />
                  <Text style={s.loginText}>{tr('¿Ya tienes cuenta AMO?')} <Text style={{ color: CMW.amber, fontWeight: '700' }}>{tr('Iniciar sesión')}</Text></Text>
                </TouchableOpacity>
              )
            )}

            {show('fullName') && ((!user || ask.fullName) ? (
              /* Collecting the name fresh → Nombre + Apellidos, as the CMW spec asks. */
              <View style={s.placeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{tr('Nombre')}</Text>
                  <TextInput value={fullName} onChangeText={onField(setFullName, 'name')} placeholder={tr('Nombre')} placeholderTextColor={CMW.sandFaint}
                    autoCapitalize="words" autoComplete="name-given" textContentType="givenName" maxLength={80}
                    style={[s.input, has('name') && s.inputError]} testID="cmw-pre-name" />
                  {has('name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.name)}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{tr('Apellidos')}</Text>
                  <TextInput value={lastName} onChangeText={onField(setLastName, 'last_name')} placeholder={tr('Apellidos')} placeholderTextColor={CMW.sandFaint}
                    autoCapitalize="words" autoComplete="name-family" textContentType="familyName" maxLength={80}
                    style={[s.input, has('last_name') && s.inputError]} testID="cmw-pre-lastname" />
                  {has('last_name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.last_name)}</Text>}
                </View>
              </View>
            ) : (
              /* Editing a profile that already carries one combined name field. */
              <>
                <Text style={s.label}>{tr('Nombre completo')}</Text>
                <TextInput value={fullName} onChangeText={onField(setFullName, 'name')} placeholder={tr('Nombre')} placeholderTextColor={CMW.sandFaint}
                  autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={80}
                  style={[s.input, has('name') && s.inputError]} testID="cmw-pre-name" />
                {has('name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.name)}</Text>}
              </>
            ))}

            {show('email') && (<>
              <Text style={s.label}>{tr('Correo electrónico')}</Text>
              <TextInput value={email} onChangeText={onField(setEmail, 'email')} placeholder="tu@correo.com" placeholderTextColor={CMW.sandFaint}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}
                style={[s.input, has('email') && s.inputError]} testID="cmw-pre-email" />
              {has('email') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.email)}</Text>}
            </>)}

            {show('whatsapp') && (<>
              <Text style={s.label}>WhatsApp</Text>
              <TextInput value={whatsapp} onChangeText={onField(setWhatsapp, 'whatsapp')} placeholder="+57 300 123 4567" placeholderTextColor={CMW.sandFaint}
                keyboardType="phone-pad" autoCapitalize="none" autoCorrect={false} autoComplete="tel" textContentType="telephoneNumber" maxLength={24}
                style={[s.input, has('whatsapp') && s.inputError]} testID="cmw-pre-whatsapp" />
              <Text style={s.hint}>{tr('Número de WhatsApp con indicativo')}</Text>
              {has('whatsapp') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.whatsapp)}</Text>}
            </>)}

            {/* DOB is never on a profile — everyone is asked. 18+ hard gate. */}
            <Text style={s.label}>{tr('Fecha de nacimiento')}</Text>
            <View style={s.dobRow} testID="cmw-pre-dob">
              <TextInput value={dobD} onChangeText={onField(setDobD, 'dob')} placeholder="DD" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={2} style={[s.input, s.dobBox, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-d" />
              <TextInput value={dobM} onChangeText={onField(setDobM, 'dob')} placeholder="MM" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={2} style={[s.input, s.dobBox, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-m" />
              <TextInput value={dobY} onChangeText={onField(setDobY, 'dob')} placeholder="AAAA" placeholderTextColor={CMW.sandFaint}
                keyboardType="number-pad" maxLength={4} style={[s.input, s.dobYear, (has('dob') || has('under_18')) && s.inputError]} testID="cmw-pre-dob-y" />
            </View>
            <Text style={s.hint}>{tr('Solo mayores de 18 años.')}</Text>
            {has('dob') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.dob)}</Text>}
            {has('under_18') && (
              <View style={s.under18Box} testID="cmw-pre-under18">
                <Ionicons name="hand-left-outline" size={16} color={CMW.coral} />
                <Text style={[s.fieldError, { marginTop: 0, flex: 1 }]}>{tr(FIELD_ERROR_COPY.under_18)}</Text>
              </View>
            )}

            {show('instagram') && (<>
              {/* CMW-2: required (spec: obligatorio) — the handle is how CMW builds its audience. */}
              <Text style={s.label}>Instagram</Text>
              <TextInput value={instagram} onChangeText={onField(setInstagram, 'instagram')} placeholder="@usuario" placeholderTextColor={CMW.sandFaint}
                autoCapitalize="none" autoCorrect={false} maxLength={31}
                style={[s.input, has('instagram') && s.inputError]} testID="cmw-pre-instagram" />
              {has('instagram') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.instagram)}</Text>}
            </>)}

            <View style={s.placeRow}>
              {show('city') && (
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{tr('Ciudad')} <Text style={s.optional}>· {tr('opcional')}</Text></Text>
                  <TextInput value={city} onChangeText={setCity} placeholder={tr('Ciudad')} placeholderTextColor={CMW.sandFaint}
                    autoCapitalize="words" maxLength={60} style={s.input} testID="cmw-pre-city" />
                </View>
              )}
              {show('country') && (
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{tr('País')} <Text style={s.optional}>· {tr('opcional')}</Text></Text>
                  <TextInput value={country} onChangeText={setCountry} placeholder={tr('País')} placeholderTextColor={CMW.sandFaint}
                    autoCapitalize="words" maxLength={60} style={s.input} testID="cmw-pre-country" />
                </View>
              )}
            </View>

            {/* Género — optional, per the spec's form; chips, never a free-text box. */}
            <Text style={s.label}>{tr('Género')} <Text style={s.optional}>· {tr('opcional')}</Text></Text>
            <View style={s.genderRow} testID="cmw-pre-gender">
              {GENDER_OPTIONS.map((g) => {
                const active = gender === g.value;
                return (
                  <TouchableOpacity
                    key={g.value}
                    onPress={() => { markStarted(); setGender(active ? null : g.value); }}
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

            {/* Honeypot: off-screen, hidden from assistive tech and the tab order. */}
            <TextInput value={website} onChangeText={setWebsite} style={s.honeypot} autoComplete="off" autoCorrect={false}
              tabIndex={-1} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" editable testID="cmw-pre-website" />

            {/* ── the two SEPARATE authorizations — both start unchecked ── */}
            <Text style={[s.label, { marginTop: 22 }]}>{tr('Autorización de datos')}</Text>
            <CheckRow checked={consentChecked} onToggle={() => { setConsentChecked((v) => !v); clearError('consent'); }} testID="cmw-pre-consent">
              <Text style={s.consentText}>{tr(CONSENT_TEXT_ES)}</Text>
              <TouchableOpacity onPress={openPrivacy} style={s.consentLinkBtn} accessibilityRole="link" testID="cmw-pre-privacy">
                <Ionicons name="shield-checkmark-outline" size={14} color={CMW.amber} />
                <Text style={s.consentLink}>{tr('Política de privacidad')}</Text>
              </TouchableOpacity>
            </CheckRow>
            {has('consent') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.consent)}</Text>}

            <CheckRow checked={marketingChecked} onToggle={() => setMarketingChecked((v) => !v)} testID="cmw-pre-marketing">
              <Text style={s.consentText}>{tr(MARKETING_TEXT_ES)} <Text style={s.optional}>({tr('opcional')})</Text></Text>
            </CheckRow>

            <CmwButton
              label={sending ? tr('Enviando…') : tr('Preinscribirme')}
              icon={sending ? undefined : 'musical-notes-outline'}
              onPress={submit}
              loading={sending}
              disabled={!consentChecked}
              style={{ marginTop: 16 }}
              testID="cmw-pre-submit"
            />
            {authLoading && <ActivityIndicator size="small" color={CMW.amber} style={{ marginTop: 10 }} />}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CMW.background },
  scroll: { paddingHorizontal: CMW_GUTTER, paddingTop: 18, paddingBottom: 28, maxWidth: 640, width: '100%', alignSelf: 'center' },
  hero: { marginBottom: 18 },
  heroEyebrow: { ...CMW_TYPE.eyebrow, marginTop: 10 },

  card: {
    backgroundColor: CMW.surface, borderRadius: CMW_RADIUS.card, borderWidth: 1, borderColor: CMW.line,
    paddingHorizontal: 18, paddingVertical: 18,
  },

  loginRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, marginBottom: 6 },
  loginText: { ...CMW_TYPE.small, color: CMW.sand, flex: 1 },

  authedBox: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: CMW.lineSoft, maxWidth: '100%' },
  chipText: { fontSize: 12, fontWeight: '600', color: CMW.cream, maxWidth: 220 },
  editLink: { fontSize: 12.5, fontWeight: '700', color: CMW.amber, paddingHorizontal: 4, paddingVertical: 4 },

  label: { ...CMW_TYPE.eyebrow, color: CMW.sand, marginTop: 16, marginBottom: 8 },
  optional: { ...CMW_TYPE.small, textTransform: 'none', letterSpacing: 0, color: CMW.sandFaint },
  hint: { ...CMW_TYPE.small, marginTop: 6 },
  input: {
    minHeight: 50, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: CMW.white,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  inputError: { borderColor: CMW.coral },
  fieldError: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.coral, marginTop: 6 },

  dobRow: { flexDirection: 'row', gap: 8 },
  dobBox: { width: 64, textAlign: 'center' },
  dobYear: { width: 92, textAlign: 'center' },
  under18Box: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: 'rgba(238,107,77,0.10)', borderWidth: 1, borderColor: 'rgba(238,107,77,0.45)', marginTop: 8 },

  placeRow: { flexDirection: 'row', gap: 10 },

  honeypot: { position: 'absolute', left: -10000, top: 0, width: 1, height: 1, opacity: 0 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12, minHeight: 44 },
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkBoxOn: { backgroundColor: CMW.amber, borderColor: CMW.amber },
  consentText: { fontSize: 12.5, lineHeight: 18, fontWeight: '400', color: CMW.sand },
  consentLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32, paddingRight: 8, marginTop: 4 },
  consentLink: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: 'rgba(238,107,77,0.10)', borderWidth: 1, borderColor: 'rgba(238,107,77,0.45)', marginBottom: 12 },
  errorText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: CMW.cream },
  errorTextSecond: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.sand, marginTop: 4 },

  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genderChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)', minHeight: 40 },
  genderChipOn: { backgroundColor: 'rgba(244,164,58,0.16)', borderColor: CMW.amber },
  genderChipText: { fontSize: 13, fontWeight: '600', color: CMW.sand },
  genderChipTextOn: { color: CMW.amber },

  referralBox: { marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
  refCodeRow: { alignItems: 'center', marginTop: 12, marginBottom: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: CMW.lineSoft },
  refCode: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 2, color: CMW.gold, fontVariant: ['tabular-nums'] },
  refBtnRow: { flexDirection: 'row', gap: 8 },
  copyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, minHeight: 32 },
  copyText: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: CMW.amber, alignItems: 'center', justifyContent: 'center', marginBottom: 14, alignSelf: 'center' },
  rid: { alignItems: 'center', marginTop: 16, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
  ridLabel: { ...CMW_TYPE.eyebrow, color: CMW.sandFaint },
  ridValue: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 1.5, color: CMW.gold, marginTop: 4, fontVariant: ['tabular-nums'] },
  nudge: { marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: 'rgba(244,164,58,0.08)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
});
