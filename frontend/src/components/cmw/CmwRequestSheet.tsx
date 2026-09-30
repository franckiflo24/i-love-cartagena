// CMW concierge request sheet (docs/cmw/DESIGN.md §4 Request flow).
//
// Concierge-led, exactly as the program promises: the sheet collects a name, a
// party size, one contact and an optional note, POSTs them, and the only state
// it can ever show afterwards is "Solicitud recibida · Un concierge te
// contactará" with the request id. There is no checkout, no payment and no
// "confirmado" / "reservado" state anywhere in this file. If the POST fails, a
// bilingual error appears and the WhatsApp button still works: the URL is
// built on the phone (whatsappUrl), so the concierge line is one tap away even
// with no backend at all.
//
// The `website` field is a honeypot: no person ever sees it, so it is always ''.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLang } from '../../context/LanguageContext';
import { useTr } from '../../i18n/autoTr';
import { openExternal } from '../../lib/cityModules';
import {
  CMW_NAME, CmwContactType, CmwEvent, CmwFieldError, CmwSubmitResult, FIELD_ERROR_COPY, NOTE_MAX, PARTY_MAX, PARTY_MIN,
  dayLabel, failureCopy, submitRequest, validateRequest, whatsappUrl,
} from '../../lib/cmw';
import { CMW, CMW_GUTTER, CMW_TYPE } from './cmwTheme';
import { CmwButton, OfficialBadge } from './CmwUI';

type Props = {
  visible: boolean;
  /** null = a general enquiry about the week. */
  event: CmwEvent | null;
  onClose: () => void;
};

type Failure = Extract<CmwSubmitResult, { ok: false }>;

export default function CmwRequestSheet({ visible, event, onClose }: Props) {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [name, setName] = useState('');
  const [party, setParty] = useState(2);
  const [contactType, setContactType] = useState<CmwContactType>('whatsapp');
  const [contactValue, setContactValue] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<CmwFieldError[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CmwSubmitResult | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Each opening starts a fresh request; the name and contact are kept so a
  // second event does not mean typing them again.
  useEffect(() => {
    if (!visible) return;
    setErrors([]);
    setResult(null);
    setSending(false);
    setNote('');
  }, [visible, event?.id]);

  const heading = event ? event.title : tr('Solicitud al concierge');
  const subheading = event
    ? dayLabel(event.date, lang, { weekday: true })
    : `${tr('Consulta general')} · ${CMW_NAME}`;

  // Bilingual error: the visitor's language first, then the other official
  // line (English, or Spanish for an English visitor). Never an internal detail.
  const errorLines = useMemo(() => {
    if (!result || result.ok) return null;
    const es = failureCopy(result);
    return { primary: tr(es), secondary: lang === 'en' ? es : (EN_LINE[es] || es) };
  }, [result, lang, tr]);

  const fallbackWhatsApp = useMemo(
    () => whatsappUrl(event, lang, { partySize: party, requestId: result && result.ok ? result.requestId : null }),
    [event, lang, party, result],
  );

  const openWhatsApp = useCallback(() => {
    const url = result && result.ok ? result.whatsappUrl : fallbackWhatsApp;
    openExternal(url);
  }, [result, fallbackWhatsApp]);

  const openPrivacy = useCallback(() => {
    onClose();
    router.push('/privacidad' as never);
  }, [onClose, router]);

  const submit = useCallback(async () => {
    if (sending) return;
    const body = {
      event_id: event ? event.id : null,
      name: name.trim(),
      party_size: party,
      contact: { type: contactType, value: contactValue.trim() },
      note: note.trim(),
      lang,
      consent: true as const,
      website,
    };
    const problems = validateRequest(body);
    setErrors(problems);
    if (problems.length) return;
    setSending(true);
    setResult(null);
    const r = await submitRequest(body);
    if (!alive.current) return;
    setSending(false);
    setResult(r);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 30);
  }, [sending, event, name, party, contactType, contactValue, note, lang, website]);

  const has = (f: CmwFieldError) => errors.includes(f);
  const failure: Failure | null = result && !result.ok ? result : null;
  // A field's error is about what was submitted: editing the field clears it (the next Enviar
  // re-validates), so a visitor is never told their corrected input is still wrong.
  const clearError = useCallback((f: CmwFieldError) => { setErrors((e) => (e.includes(f) ? e.filter((x) => x !== f) : e)); }, []);
  const onName = useCallback((v: string) => { setName(v); clearError('name'); }, [clearError]);
  const onContact = useCallback((v: string) => { setContactValue(v); clearError('contact'); }, [clearError]);
  const onContactType = useCallback((t: CmwContactType) => { setContactType(t); clearError('contact'); }, [clearError]);
  const onNote = useCallback((v: string) => { setNote(v.slice(0, NOTE_MAX)); clearError('note'); }, [clearError]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.backdropWrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={tr('Cerrar')} accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="cmw-request-sheet">
            <View style={s.grabber} />
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <OfficialBadge tr={tr} />
                <Text style={[CMW_TYPE.h2, { marginTop: 8 }]} numberOfLines={2}>{heading}</Text>
                <Text style={[CMW_TYPE.small, { marginTop: 2 }]}>{subheading}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel={tr('Cerrar')} testID="cmw-request-close">
                <Ionicons name="close" size={20} color={CMW.cream} />
              </TouchableOpacity>
            </View>

            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
              {result && result.ok ? (
                <View style={s.success} testID="cmw-request-success">
                  <View style={s.successIcon}>
                    <Ionicons name="checkmark" size={28} color={CMW.onAccent} />
                  </View>
                  <Text style={[CMW_TYPE.h2, { textAlign: 'center' }]}>{tr('Solicitud recibida')}</Text>
                  <Text style={[CMW_TYPE.body, { textAlign: 'center', marginTop: 4 }]}>{tr('Un concierge te contactará')}</Text>
                  <View style={s.rid}>
                    <Text style={s.ridLabel}>{tr('Número de solicitud')}</Text>
                    <Text style={s.ridValue} selectable testID="cmw-request-id">{result.requestId}</Text>
                  </View>
                  <Text style={[CMW_TYPE.small, { textAlign: 'center' }]}>{tr('Guarda este número por si necesitas seguimiento.')}</Text>
                  <CmwButton label={tr('Escribir por WhatsApp ahora')} icon="logo-whatsapp" onPress={openWhatsApp} style={{ marginTop: 18 }} testID="cmw-request-whatsapp" />
                  <CmwButton label={tr('Cerrar')} variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
                </View>
              ) : (
                <>
                  {failure && errorLines && (
                    <View style={s.errorBox} testID="cmw-request-error" accessibilityRole="alert">
                      <Ionicons name="alert-circle-outline" size={18} color={CMW.coral} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.errorText}>{errorLines.primary}</Text>
                        <Text style={s.errorTextSecond}>{errorLines.secondary}</Text>
                      </View>
                    </View>
                  )}
                  {failure && (
                    <CmwButton label={tr('Escribir por WhatsApp')} icon="logo-whatsapp" variant="secondary" onPress={openWhatsApp} style={{ marginBottom: 18 }} testID="cmw-request-whatsapp-fallback" />
                  )}

                  <Text style={s.label}>{tr('Tu nombre')}</Text>
                  <TextInput
                    value={name}
                    onChangeText={onName}
                    placeholder={tr('Nombre')}
                    placeholderTextColor={CMW.sandFaint}
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                    maxLength={80}
                    style={[s.input, has('name') && s.inputError]}
                    testID="cmw-request-name"
                  />
                  {has('name') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.name)}</Text>}

                  <Text style={s.label}>{tr('Número de personas')}</Text>
                  <View style={s.stepper} testID="cmw-request-party">
                    <TouchableOpacity
                      onPress={() => setParty((n) => Math.max(PARTY_MIN, n - 1))}
                      disabled={party <= PARTY_MIN}
                      style={[s.stepBtn, party <= PARTY_MIN && s.stepBtnOff]}
                      accessibilityRole="button"
                      accessibilityLabel={tr('Menos personas')}
                      testID="cmw-request-party-minus"
                    >
                      <Ionicons name="remove" size={20} color={CMW.cream} />
                    </TouchableOpacity>
                    <Text style={s.stepValue} accessibilityLiveRegion="polite" testID="cmw-request-party-value">{party}</Text>
                    <TouchableOpacity
                      onPress={() => setParty((n) => Math.min(PARTY_MAX, n + 1))}
                      disabled={party >= PARTY_MAX}
                      style={[s.stepBtn, party >= PARTY_MAX && s.stepBtnOff]}
                      accessibilityRole="button"
                      accessibilityLabel={tr('Más personas')}
                      testID="cmw-request-party-plus"
                    >
                      <Ionicons name="add" size={20} color={CMW.cream} />
                    </TouchableOpacity>
                    <Text style={s.stepHint}>{tr('Personas')}</Text>
                  </View>
                  {has('party_size') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.party_size)}</Text>}

                  <Text style={s.label}>{tr('¿Cómo te contactamos?')}</Text>
                  <View style={s.segmented} accessibilityRole="tablist">
                    {(['whatsapp', 'email'] as const).map((t) => {
                      const on = contactType === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          onPress={() => onContactType(t)}
                          style={[s.segment, on && s.segmentOn]}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: on }}
                          aria-selected={on}
                          testID={`cmw-request-contact-${t}`}
                        >
                          <Ionicons name={t === 'whatsapp' ? 'logo-whatsapp' : 'mail-outline'} size={15} color={on ? CMW.onAccent : CMW.sand} />
                          <Text style={[s.segmentText, on && s.segmentTextOn]}>{t === 'whatsapp' ? 'WhatsApp' : tr('Correo electrónico')}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    value={contactValue}
                    onChangeText={onContact}
                    placeholder={contactType === 'whatsapp' ? '+57 300 123 4567' : tr('Tu correo electrónico')}
                    placeholderTextColor={CMW.sandFaint}
                    keyboardType={contactType === 'whatsapp' ? 'phone-pad' : 'email-address'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={contactType === 'whatsapp' ? 'tel' : 'email'}
                    textContentType={contactType === 'whatsapp' ? 'telephoneNumber' : 'emailAddress'}
                    maxLength={contactType === 'whatsapp' ? 24 : 254}
                    style={[s.input, { marginTop: 8 }, has('contact') && s.inputError]}
                    testID="cmw-request-contact"
                  />
                  <Text style={s.hint}>{contactType === 'whatsapp' ? tr('Número de WhatsApp con indicativo') : tr('Tu correo electrónico')}</Text>
                  {has('contact') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.contact)}</Text>}

                  <Text style={s.label}>{tr('Nota (opcional)')}</Text>
                  <TextInput
                    value={note}
                    onChangeText={onNote}
                    placeholder={tr('Mesa, traslados, fechas, lo que necesites')}
                    placeholderTextColor={CMW.sandFaint}
                    multiline
                    maxLength={NOTE_MAX}
                    style={[s.input, s.inputMulti, has('note') && s.inputError]}
                    testID="cmw-request-note"
                  />
                  {has('note') && <Text style={s.fieldError}>{tr(FIELD_ERROR_COPY.note)}</Text>}

                  {/* Honeypot: off-screen, hidden from assistive tech and the tab order. */}
                  <TextInput
                    value={website}
                    onChangeText={setWebsite}
                    style={s.honeypot}
                    autoComplete="off"
                    autoCorrect={false}
                    tabIndex={-1}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    editable
                    testID="cmw-request-website"
                  />

                  <Text style={s.consent}>{tr('Al enviar, aceptas que el concierge de Cartagena Music Week te contacte.')}</Text>
                  <TouchableOpacity onPress={openPrivacy} style={s.consentLinkBtn} accessibilityRole="link" testID="cmw-request-privacy">
                    <Ionicons name="shield-checkmark-outline" size={14} color={CMW.amber} />
                    <Text style={s.consentLink}>{tr('Política de privacidad')}</Text>
                  </TouchableOpacity>
                  <CmwButton
                    label={sending ? tr('Enviando…') : tr('Enviar solicitud')}
                    icon={sending ? undefined : 'paper-plane-outline'}
                    onPress={submit}
                    loading={sending}
                    style={{ marginTop: 6 }}
                    testID="cmw-request-submit"
                  />
                  {!failure && (
                    <CmwButton label={tr('Escribir por WhatsApp')} icon="logo-whatsapp" variant="ghost" onPress={openWhatsApp} style={{ marginTop: 4 }} testID="cmw-request-whatsapp-alt" />
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// The English half of every error the sheet can show, keyed by its Spanish
// source text (the same pairs as src/i18n/autoTrCmw.ts, kept here so the second
// line is English whatever the visitor's language).
const EN_LINE: Record<string, string> = {
  'Escribe tu nombre (2 a 80 caracteres).': 'Enter your name (2 to 80 characters).',
  'El número de personas debe estar entre 1 y 50.': 'The party size must be between 1 and 50.',
  'Escribe un número de WhatsApp con indicativo o un correo válido.': 'Enter a WhatsApp number with country code or a valid email.',
  'La nota puede tener hasta 500 caracteres.': 'The note can be up to 500 characters.',
  'Ese evento no está en el programa oficial.': 'That event is not in the official program.',
  'Necesitamos tu autorización para que el concierge te contacte.': 'We need your consent so the concierge can contact you.',
  'Demasiadas solicitudes. Intenta de nuevo en una hora o escríbenos por WhatsApp.': 'Too many requests. Try again in an hour or message us on WhatsApp.',
  'El servicio no está disponible en este momento. Intenta de nuevo o escríbenos por WhatsApp.': 'The service is unavailable right now. Try again or message us on WhatsApp.',
  'No pudimos enviar tu solicitud. Escríbenos por WhatsApp.': "We couldn't send your request. Message us on WhatsApp.",
};

const s = StyleSheet.create({
  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,4,8,0.62)' },
  kav: { justifyContent: 'flex-end', maxHeight: '94%' },
  sheet: {
    backgroundColor: CMW.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderBottomWidth: 0, borderColor: CMW.line, maxHeight: '100%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: CMW_GUTTER, paddingTop: 14, paddingBottom: 10 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: CMW.lineSoft },
  body: { paddingHorizontal: CMW_GUTTER, paddingBottom: 24 },

  label: { ...CMW_TYPE.eyebrow, color: CMW.sand, marginTop: 16, marginBottom: 8 },
  hint: { ...CMW_TYPE.small, marginTop: 6 },
  input: {
    minHeight: 50, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: CMW.white,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  inputMulti: { minHeight: 92, textAlignVertical: 'top' },
  inputError: { borderColor: CMW.coral },
  fieldError: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.coral, marginTop: 6 },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  stepBtnOff: { opacity: 0.35 },
  stepValue: { ...CMW_TYPE.dayNumber, minWidth: 40, textAlign: 'center', fontSize: 26, lineHeight: 30 },
  stepHint: { ...CMW_TYPE.small, marginLeft: 2 },

  segmented: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  segment: { flex: 1, minHeight: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segmentOn: { backgroundColor: CMW.amber },
  segmentText: { fontSize: 13.5, fontWeight: '600', color: CMW.sand },
  segmentTextOn: { color: CMW.onAccent, fontWeight: '700' },

  honeypot: { position: 'absolute', left: -10000, top: 0, width: 1, height: 1, opacity: 0 },

  consent: { ...CMW_TYPE.small, marginTop: 18, lineHeight: 18 },
  consentLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44, paddingRight: 8 },
  consentLink: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: 'rgba(238,107,77,0.10)', borderWidth: 1, borderColor: 'rgba(238,107,77,0.45)', marginTop: 4, marginBottom: 12 },
  errorText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: CMW.cream },
  errorTextSecond: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.sand, marginTop: 4 },

  success: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: CMW.amber, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  rid: { alignItems: 'center', marginTop: 16, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: CMW.line, alignSelf: 'stretch' },
  ridLabel: { ...CMW_TYPE.eyebrow, color: CMW.sandFaint },
  ridValue: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 1.5, color: CMW.gold, marginTop: 4, fontVariant: ['tabular-nums'] },
});
