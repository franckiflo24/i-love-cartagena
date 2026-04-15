import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && !isLoading) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Image
        source={{ uri: 'https://static.prod-images.emergentagent.com/jobs/32dad071-4fb0-440b-90c6-bb16ae39bea1/images/2dee6fa4415e057ea67df10585454bc47023ea1133b28fa1c91e8ee307f1d323.png' }}
        style={styles.heroImage}
      />
      <View style={styles.overlay} />
      <View style={styles.content}>
        <View style={styles.logoArea}>
          <Text style={styles.logoPrefix}>I</Text>
          <Text style={styles.logoHeart}>❤️</Text>
          <Text style={styles.logoMusic}>MÚSICA</Text>
          <Text style={styles.logoMain}>CARTAGENA</Text>
          <View style={styles.divider} />
          <Text style={styles.tagline}>La experiencia musical de la ciudad</Text>
        </View>

        <View style={styles.bottomArea}>
          <Text style={styles.welcomeText}>
            Conciertos, agenda, partners y reservas en un solo lugar
          </Text>

          <TouchableOpacity
            testID="login-google-btn"
            style={styles.googleButton}
            onPress={login}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-google" size={20} color={COLORS.white} />
            <Text style={styles.googleButtonText}>Continuar con Google</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="explore-guest-btn"
            style={styles.guestButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.8}
          >
            <Text style={styles.guestButtonText}>Explorar como invitado</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Al continuar, aceptas los términos y condiciones de Música Cartagena
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  heroImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 8, 20, 0.7)' },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.xxl * 2, paddingBottom: SPACING.xl },
  logoArea: { alignItems: 'center' },
  logoPrefix: { fontSize: 32, letterSpacing: 4, color: COLORS.textMain, ...FONTS.light },
  logoHeart: { fontSize: 48, marginVertical: SPACING.xs },
  logoMusic: { fontSize: 22, letterSpacing: 6, color: COLORS.primary, ...FONTS.bold, textTransform: 'uppercase' },
  logoMain: { fontSize: 42, letterSpacing: 2, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.xs },
  divider: { width: 60, height: 2, backgroundColor: COLORS.primary, marginTop: SPACING.md, borderRadius: 1 },
  tagline: { fontSize: 15, color: COLORS.textMuted, marginTop: SPACING.md, ...FONTS.light, letterSpacing: 1 },
  bottomArea: { alignItems: 'center', gap: SPACING.md },
  welcomeText: { fontSize: 16, color: COLORS.textMuted, textAlign: 'center', lineHeight: 24, ...FONTS.regular, marginBottom: SPACING.sm },
  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: 16, paddingHorizontal: SPACING.xl, width: '100%', gap: SPACING.sm,
  },
  googleButtonText: { fontSize: 16, color: COLORS.white, ...FONTS.semibold },
  guestButton: {
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 14, paddingHorizontal: SPACING.xl, width: '100%', alignItems: 'center',
  },
  guestButtonText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.medium },
  disclaimer: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.sm, opacity: 0.6 },
});
