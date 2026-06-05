import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';

const CATEGORY_ORDER = ['police', 'fire', 'health', 'civil_defense', 'maritime', 'transit', 'government', 'utilities'];
const CATEGORY_LABELS: Record<string, string> = {
  police: 'Policía y Seguridad',
  fire: 'Bomberos',
  health: 'Salud y Emergencias',
  civil_defense: 'Defensa Civil',
  maritime: 'Emergencias Marítimas',
  transit: 'Tránsito',
  government: 'Gobierno',
  utilities: 'Servicios Públicos',
};
const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  police: { bg: 'rgba(59,130,246,0.12)', fg: '#3B82F6' },
  fire: { bg: 'rgba(249,115,22,0.12)', fg: '#F97316' },
  health: { bg: 'rgba(239,68,68,0.12)', fg: '#EF4444' },
  civil_defense: { bg: 'rgba(234,179,8,0.12)', fg: '#EAB308' },
  maritime: { bg: 'rgba(6,182,212,0.12)', fg: '#06B6D4' },
  transit: { bg: 'rgba(107,114,128,0.12)', fg: '#6B7280' },
  government: { bg: 'rgba(168,85,247,0.12)', fg: '#A855F7' },
  utilities: { bg: 'rgba(34,197,94,0.12)', fg: '#22C55E' },
};

function dialPhone(phone: string) {
  const clean = phone.replace(/[^\d]/g, '');
  if (clean.length <= 3) {
    Linking.openURL(`tel:${clean}`);
  } else if (clean.startsWith('57')) {
    Linking.openURL(`tel:+${clean}`);
  } else {
    Linking.openURL(`tel:+57${clean}`);
  }
}

export default function HelpScreen() {
  const tr = useTr();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'bug' | 'idea'>('idea');
  const [sending, setSending] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/emergency-contacts').then(d => setEmergencyContacts(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const appVersion = (Constants?.expoConfig as any)?.version || '1.0.0';

  const send = async () => {
    if (!message.trim() || message.trim().length < 5) {
      Alert.alert(tr('Mensaje muy corto'), tr('Cuéntanos un poco más.'));
      return;
    }
    setSending(true);
    try {
      await api.post('/feedback', { kind, message: message.trim(), platform: Platform.OS, app_version: appVersion });
      Alert.alert(tr('Gracias'), tr('Recibimos tu mensaje.'));
      setMessage('');
      router.back();
    } catch { Alert.alert(tr('Error'), tr('No pudimos enviar. Escríbenos a soporte@amocartagena.app')); }
    setSending(false);
  };

  // Group emergency contacts by category
  const grouped: Record<string, any[]> = {};
  emergencyContacts.forEach(c => {
    const cat = c.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.title}>Ayuda y Emergencias</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ── EMERGENCY SOS BANNER ── */}
          <TouchableOpacity style={styles.sosBanner} onPress={() => dialPhone('123')} activeOpacity={0.85}>
            <View style={styles.sosIcon}>
              <Ionicons name="call" size={24} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sosTitle}>Emergencia — Llamar 123</Text>
              <Text style={styles.sosSubtitle}>Policía, Ambulancia, Bomberos</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          {/* ── QUICK DIAL — most critical numbers ── */}
          <View style={styles.quickDialRow}>
            {[
              { label: 'Policía', phone: '123', icon: 'shield', color: '#3B82F6' },
              { label: 'Bomberos', phone: '119', icon: 'flame', color: '#F97316' },
              { label: 'Cruz Roja', phone: '132', icon: 'medkit', color: '#EF4444' },
              { label: 'Tránsito', phone: '127', icon: 'car', color: '#6B7280' },
            ].map((item, i) => (
              <TouchableOpacity key={i} style={styles.quickDialCard} onPress={() => dialPhone(item.phone)} activeOpacity={0.85}>
                <View style={[styles.quickDialIcon, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                </View>
                <Text style={styles.quickDialLabel}>{item.label}</Text>
                <Text style={styles.quickDialNumber}>{item.phone}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── ALL EMERGENCY CONTACTS BY CATEGORY ── */}
          {CATEGORY_ORDER.map(cat => {
            const contacts = grouped[cat];
            if (!contacts || contacts.length === 0) return null;
            const colors = CATEGORY_COLORS[cat] || { bg: 'rgba(107,114,128,0.12)', fg: '#6B7280' };
            return (
              <View key={cat} style={styles.catSection}>
                <Text style={[styles.catLabel, { color: colors.fg }]}>{CATEGORY_LABELS[cat] || cat}</Text>
                {contacts.map((c: any) => (
                  <View key={c.contact_id} style={styles.contactCard}>
                    <View style={[styles.contactIcon, { backgroundColor: colors.bg }]}>
                      <Ionicons name={(c.icon || 'call') as any} size={16} color={colors.fg} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      {c.email ? <Text style={styles.contactEmail}>{c.email}</Text> : null}
                    </View>
                    <View style={styles.phoneButtons}>
                      {c.phones?.map((p: any, pi: number) => (
                        <TouchableOpacity key={pi} style={styles.phoneBtn} onPress={() => dialPhone(p.phone)} activeOpacity={0.8}>
                          <Ionicons name="call" size={12} color={COLORS.primary} />
                          <Text style={styles.phoneBtnText}>{p.phone}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            );
          })}

          {/* ── CONTACT AMO ── */}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.xl }]}>Contactar AMO Cartagena</Text>
          <TouchableOpacity style={styles.amoContact} onPress={() => Linking.openURL('mailto:soporte@amocartagena.app')}>
            <View style={[styles.contactIcon, { backgroundColor: COLORS.primary + '18' }]}>
              <Ionicons name="mail" size={16} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>soporte@amocartagena.app</Text>
            </View>
            <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
          </TouchableOpacity>

          {/* ── FEEDBACK ── */}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.xl }]}>Enviar comentario</Text>
          <View style={styles.kindRow}>
            {[
              { id: 'bug' as const, label: 'Reportar problema', icon: 'bug' as const, color: '#EF4444' },
              { id: 'idea' as const, label: 'Sugerencia', icon: 'bulb' as const, color: '#D4AF37' },
            ].map(k => (
              <TouchableOpacity
                key={k.id}
                style={[styles.kindChip, kind === k.id && { backgroundColor: k.color + '18', borderColor: k.color }]}
                onPress={() => setKind(k.id)}
                activeOpacity={0.85}
              >
                <Ionicons name={k.icon} size={14} color={kind === k.id ? k.color : COLORS.textMuted} />
                <Text style={[styles.kindText, kind === k.id && { color: k.color, ...FONTS.bold }]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Cuéntanos qué pasó o qué necesitas..."
            placeholderTextColor={COLORS.textFaint}
            multiline
            numberOfLines={4}
            maxLength={2000}
            textAlignVertical="top"
          />
          <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending}>
            {sending ? <ActivityIndicator color={COLORS.black} size="small" /> : <Ionicons name="send" size={14} color={COLORS.black} />}
            <Text style={styles.sendBtnText}>{sending ? 'Enviando...' : 'Enviar'}</Text>
          </TouchableOpacity>

          {/* ── LEGAL ── */}
          <View style={styles.legalRow}>
            <TouchableOpacity style={styles.legalBtn} onPress={() => router.push('/terminos' as any)}>
              <Text style={styles.legalText}>Términos</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity style={styles.legalBtn} onPress={() => router.push('/privacidad' as any)}>
              <Text style={styles.legalText}>Privacidad</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.versionFooter}>AMO Cartagena · v{appVersion}</Text>
          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },

  // SOS Banner
  sosBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: '#DC2626', borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.md },
  sosIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosTitle: { fontSize: 16, color: '#FFF', ...FONTS.bold },
  sosSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', ...FONTS.medium, marginTop: 2 },

  // Quick Dial
  quickDialRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  quickDialCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: 'center', gap: 6 },
  quickDialIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quickDialLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  quickDialNumber: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },

  // Category sections
  catSection: { marginBottom: SPACING.md },
  catLabel: { fontSize: 11, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.sm },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, marginBottom: 4 },
  contactIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  contactName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  contactEmail: { fontSize: 10, color: COLORS.textFaint, ...FONTS.regular, marginTop: 1 },
  phoneButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 120 },
  phoneBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.primary + '15', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 4 },
  phoneBtnText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },

  // AMO Contact
  amoContact: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.xs },

  // Feedback
  sectionLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.sm },
  kindRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  kindText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, fontSize: 14, color: COLORS.textMain, ...FONTS.regular, minHeight: 80 },
  sendBtn: { marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: RADIUS.full },
  sendBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },

  // Legal
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.xl },
  legalBtn: { paddingVertical: 4 },
  legalText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  legalDot: { fontSize: 12, color: COLORS.textFaint },
  versionFooter: { fontSize: 10, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center', marginTop: SPACING.md, letterSpacing: 0.5 },
});
