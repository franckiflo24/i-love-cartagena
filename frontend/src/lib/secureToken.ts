import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Bearer tokens belong in the iOS Keychain / Android Keystore on native —
// AsyncStorage persists to plaintext SQLite in the app sandbox, liftable from
// unencrypted backups. Web stays on AsyncStorage (localStorage-backed), same
// as the consumer session in AuthContext. Reads fall back to AsyncStorage
// once and migrate any pre-existing token so live sessions survive the
// upgrade. Keys must match SecureStore's [A-Za-z0-9._-] charset.

export async function setSecureToken(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getSecureToken(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  const v = await SecureStore.getItemAsync(key);
  if (v != null) return v;
  const legacy = await AsyncStorage.getItem(key);
  if (legacy != null) {
    try {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
    } catch {
      // Migration is best-effort — the legacy value still works this session.
    }
  }
  return legacy;
}

export async function deleteSecureToken(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  try { await SecureStore.deleteItemAsync(key); } catch {}
  try { await AsyncStorage.removeItem(key); } catch {} // clear any un-migrated legacy copy
}
