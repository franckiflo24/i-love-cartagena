/**
 * Global ErrorBoundary — catches React rendering errors so the app doesn't
 * white-screen in production. Reports the crash to the backend crash beacon
 * (/api/client-error → client_errors + admin alert + Eagle Eye KPI) and shows
 * a friendly fallback with a "Try again" button.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';
import { useTr } from '@/src/i18n/autoTr';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

// Fallback UI as a function component so it can use the translation hook
// (the boundary itself must stay a class for getDerivedStateFromError).
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const tr = useTr();
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="warning" size={48} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>{tr('Algo salió mal')}</Text>
      <Text style={styles.subtitle}>
        {tr('Tuvimos un problema mostrando esta pantalla. Ya enviamos un reporte automático al equipo.')}
      </Text>
      <TouchableOpacity style={styles.homeBtn} onPress={() => {
        if (typeof window !== 'undefined') {
          window.location.href = '/';
        } else {
          onReset();
        }
      }} activeOpacity={0.85}>
        <Ionicons name="home" size={16} color={COLORS.textMain} />
        <Text style={styles.homeBtnText}>{tr('Volver al inicio')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cta} onPress={onReset} activeOpacity={0.85}>
        <Ionicons name="refresh" size={16} color="#FFF" />
        <Text style={styles.ctaText}>{tr('Reintentar')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for debugging — never show to user
    console.error('[ErrorBoundary]', error?.message, error?.stack?.slice(0, 2000));
    // Crash beacon → POST /api/client-error (anonymous, rate-limited server-side).
    // Fire-and-forget: context gathering is async but nothing here blocks the
    // fallback render, and a reporting failure can never worsen the crash.
    try {
      const message = (error?.message || 'Unknown').slice(0, 500);
      const stack = [error?.stack || '', info?.componentStack || '']
        .filter(Boolean).join('\n— component stack —\n').slice(0, 2000);
      const route = (typeof window !== 'undefined' && window.location?.pathname) || '';
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      (async () => {
        let app_version = '';
        let lang = '';
        let user_type = '';
        try {
          // Same stamp +html.tsx writes at build time (web); empty on native.
          if (typeof window !== 'undefined' && window.localStorage) {
            app_version = window.localStorage.getItem('amo_app_version') || '';
          }
          lang = (await AsyncStorage.getItem('@musica_lang')) || '';
          const prof = await AsyncStorage.getItem('@onboarding_profile');
          if (prof) user_type = JSON.parse(prof)?.user_type || '';
        } catch { /* context is best-effort — report the crash regardless */ }
        await api.post('/client-error', { message, stack, route, app_version, user_type, lang, ua });
      })().catch(() => null);
    } catch { /* crash report itself failed — cannot crash the boundary */ }
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children as React.ReactElement;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  iconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(18,181,165,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(18,181,165,0.3)' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20 },
  homeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, paddingVertical: 11, paddingHorizontal: 24, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  homeBtnText: { fontSize: 14, color: COLORS.textMain, ...FONTS.medium },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 13, paddingHorizontal: 30, borderRadius: RADIUS.full },
  ctaText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
});
