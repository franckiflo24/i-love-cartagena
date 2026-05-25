import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';

export default function HelpScreen() {
  const tr = useTr();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'bug' | 'idea' | 'partner' | 'other'>('idea');
  const [sending, setSending] = useState(false);

  const appVersion = (Constants?.expoConfig as any)?.version || '1.0.0';

  const KINDS: { id: typeof kind; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { id: 'bug',     label: tr('Reportar bug'),      icon: 'bug',        color: '#EF4444' },
    { id: 'idea',    label: tr('Sugerencia'),        icon: 'bulb',       color: '#F59E0B' },
    { id: 'partner', label: tr('Soy partner'),       icon: 'storefront', color: '#22C55E' },
    { id: 'other',   label: tr('Otro'),              icon: 'mail',       color: COLORS.primary },
  ];

  const send = async () => {
    if (!message.trim() || message.trim().length < 5) {
      Alert.alert(tr('Mensaje muy corto'), tr('Cuéntanos un poco más para poder ayudarte.'));
      return;
    }
    setSending(true);
    try {
      await api.post('/feedback', {
        kind,
        message: message.trim(),
        platform: Platform.OS,
        app_version: appVersion,
      });
      Alert.alert(tr('¡Gracias!'), tr('Recibimos tu mensaje. Te responderemos por correo en máximo 48 horas.'));
      setMessage('');
      router.back();
    } catch (e) {
      Alert.alert(tr('Error'), tr('No pudimos enviar tu mensaje. Escríbenos directamente a soporte@amocartagena.app'));
    }
    setSending(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="help-back">
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.title}>{tr('Ayuda y Soporte')}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>{tr('Tipo de mensaje')}</Text>
          <View style={styles.kindRow}>
            {KINDS.map(k => (
              <TouchableOpacity
                key={k.id}
                style={[styles.kindChip, kind === k.id && { backgroundColor: k.color + '22', borderColor: k.color }]}
                onPress={() => setKind(k.id)}
                activeOpacity={0.85}
              >
                <Ionicons name={k.icon} size={14} color={kind === k.id ? k.color : COLORS.textMuted} />
                <Text style={[styles.kindText, kind === k.id && { color: k.color, ...FONTS.bold }]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>{tr('Mensaje')}</Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder={tr('Cuéntanos en detalle qué pasó o qué necesitas…')}
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={6}
            maxLength={2000}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{message.length}/2000</Text>

          <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending}>
            {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="send" size={16} color="#FFF" />}
            <Text style={styles.sendBtnText}>{sending ? tr('Enviando...') : tr('Enviar mensaje')}</Text>
          </TouchableOpacity>

          {/* Quick contacts */}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.xl }]}>{tr('Contacto directo')}</Text>
          <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL('mailto:soporte@amocartagena.app')}>
            <View style={[styles.contactIcon, { backgroundColor: 'rgba(217,119,6,0.15)' }]}>
              <Ionicons name="mail" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>{tr('Correo')}</Text>
              <Text style={styles.contactValue}>soporte@amocartagena.app</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL('https://wa.me/573000000000')}>
            <View style={[styles.contactIcon, { backgroundColor: 'rgba(37,211,102,0.15)' }]}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>WhatsApp</Text>
              <Text style={styles.contactValue}>+57 300 000 0000</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>

          {/* Legal links */}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.xl }]}>{tr('Legal')}</Text>
          <TouchableOpacity style={styles.legalRow} onPress={() => router.push('/terminos' as any)}>
            <Ionicons name="document-text-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.legalText}>{tr('Términos y Condiciones')}</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.legalRow} onPress={() => router.push('/privacidad' as any)}>
            <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.legalText}>{tr('Política de Privacidad')}</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
          </TouchableOpacity>

          <Text style={styles.versionFooter}>Amo Cartagena · {tr('Versión')} {appVersion}</Text>
          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  sectionLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.xs },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  kindText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, fontSize: 14, color: COLORS.textMain, ...FONTS.regular, minHeight: 120, maxHeight: 220 },
  charCount: { fontSize: 10, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },
  sendBtn: { marginTop: SPACING.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.full },
  sendBtnText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.xs },
  contactIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  contactValue: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6 },
  legalText: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.medium },
  versionFooter: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', marginTop: SPACING.xl, letterSpacing: 0.5 },
});
