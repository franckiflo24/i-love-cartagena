import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../src/constants/theme';

export default function Index() {
  const { user, isLoading } = useAuth();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('@onboarding_done').then(val => {
      setOnboardingDone(val === 'true');
    });
  }, []);

  if (isLoading || onboardingDone === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
