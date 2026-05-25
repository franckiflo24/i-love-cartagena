/**
 * Global ErrorBoundary — catches React rendering errors so the app doesn't
 * white-screen in production. Reports the error to the backend (/api/feedback)
 * and shows a friendly fallback with a "Try again" button.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Best-effort backend report. Never crash the boundary itself.
    try {
      api.post('/feedback', {
        kind: 'crash',
        message: error?.message || 'Unknown',
        stack: (error?.stack || '').slice(0, 4000),
        component_stack: (info?.componentStack || '').slice(0, 2000),
        platform: 'app',
      }).catch(() => null);
    } catch { /* noop */ }
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <Ionicons name="warning" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.subtitle}>
            Tuvimos un problema mostrando esta pantalla. Ya enviamos un reporte automático al equipo.
          </Text>
          <ScrollView style={styles.errorBox} contentContainerStyle={{ padding: SPACING.sm }}>
            <Text style={styles.errorText}>{this.state.error?.message || 'Error desconocido'}</Text>
          </ScrollView>
          <TouchableOpacity style={styles.cta} onPress={this.reset} activeOpacity={0.85}>
            <Ionicons name="refresh" size={16} color="#FFF" />
            <Text style={styles.ctaText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  iconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(217,119,6,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(217,119,6,0.3)' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20 },
  errorBox: { maxHeight: 120, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, width: '100%' },
  errorText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, fontFamily: 'monospace' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 13, paddingHorizontal: 30, borderRadius: RADIUS.full },
  ctaText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
});
