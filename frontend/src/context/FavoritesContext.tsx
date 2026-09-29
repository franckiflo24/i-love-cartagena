import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { api } from '../constants/api';
import { takePendingAvisame } from '../lib/eventNotif';

type FavItem = { item_id: string; item_type: string };

/** 'failed' = the server did not confirm the save — never show it as saved. */
export type EnsureFavoriteResult = 'added' | 'exists' | 'failed';

type FavContextType = {
  favorites: FavItem[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, type: string) => Promise<void>;
  /** Idempotent add (POST /favorites/add) — never removes. Used by "Avísame". */
  ensureFavorite: (id: string, type: string) => Promise<EnsureFavoriteResult>;
  refreshFavorites: () => Promise<void>;
};

const FavContext = createContext<FavContextType>({
  favorites: [],
  isFavorite: () => false,
  toggleFavorite: async () => {},
  ensureFavorite: async () => 'failed',
  refreshFavorites: async () => {},
});

export const useFavorites = () => useContext(FavContext);

const STORAGE_KEY = '@musica_cartagena_favs';

// A guest tapped "Avísame" → we stored the event and sent them to /login. Once
// they are signed in, save it for real (server-side, so the reminder cron sees
// it). One-shot: the key is cleared before the request so a failure can't loop.
async function applyPendingAvisame(): Promise<boolean> {
  const eventId = await takePendingAvisame();
  if (!eventId) return false;
  try {
    await api.post('/favorites/add', { item_id: eventId, item_type: 'event' });
    return true;
  } catch (e) {
    console.error('[FavoritesContext] pending avisame apply failed', e);
    return false;
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const profileRebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFavorites = useCallback(async () => {
    try {
      if (user) {
        const data = await api.get('/favorites/ids');
        setFavorites(Array.isArray(data) ? data : []);
      } else {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) { try { const p = JSON.parse(stored); if (Array.isArray(p)) setFavorites(p); } catch { /* malformed stored favorites */ } }
      }
    } catch (e) {
      console.error('[FavoritesContext] loadFavorites failed', e);
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) { const p = JSON.parse(stored); if (Array.isArray(p)) setFavorites(p); }
      } catch { /* malformed stored favorites */ }
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadFavorites();
      if (!user || cancelled) return;
      // Re-read after applying so the list reflects what the server stored.
      if (await applyPendingAvisame()) {
        if (!cancelled) await loadFavorites();
      }
    })();
    return () => { cancelled = true; };
  }, [loadFavorites, user]);

  const isFavorite = useCallback((id: string) => {
    if (!id || !Array.isArray(favorites)) return false;
    return favorites.some(f => f.item_id === id);
  }, [favorites]);

  // Debounced AI profile rebuild — fire-and-forget, shared by toggle + ensure.
  const scheduleProfileRebuild = useCallback(async (newFavs: FavItem[]) => {
    try {
      const userRaw = await AsyncStorage.getItem('user_data');
      const cachedUser = userRaw ? JSON.parse(userRaw) : null;
      const userId = cachedUser?.user_id || user?.user_id;
      if (userId && newFavs.length >= 2) {
        // Cancel any prior pending rebuild
        if (profileRebuildTimer.current) {
          clearTimeout(profileRebuildTimer.current);
        }
        profileRebuildTimer.current = setTimeout(() => {
          api.post('/profile/build', { user_id: userId, favorites: newFavs }).catch(() => {});
        }, 1500); // debounce: wait 1.5s after last change
      }
    } catch { /* fire-and-forget profile rebuild — non-critical */ }
  }, [user]);

  const toggleFavorite = useCallback(async (id: string, type: string) => {
    if (!id || !Array.isArray(favorites)) return;
    const exists = favorites.some(f => f.item_id === id);
    let newFavs: FavItem[];

    if (exists) {
      newFavs = favorites.filter(f => f.item_id !== id);
    } else {
      newFavs = [...favorites, { item_id: id, item_type: type }];
    }
    setFavorites(newFavs);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newFavs));

    // Sync with backend if logged in
    if (user) {
      try {
        await api.post('/favorites/toggle', { item_id: id, item_type: type });
      } catch (e) { console.error('Favorite sync error:', e); }
    }

    await scheduleProfileRebuild(newFavs);
  }, [favorites, user, scheduleProfileRebuild]);

  // Signed in: SERVER-FIRST (not optimistic) — "Avísame" may only say "saved"
  // once the server that runs the reminder cron has the favorite. Guest: local.
  const ensureFavorite = useCallback(async (id: string, type: string): Promise<EnsureFavoriteResult> => {
    if (!id || !type) return 'failed';
    const already = Array.isArray(favorites) && favorites.some(f => f.item_id === id);
    let result: EnsureFavoriteResult = already ? 'exists' : 'added';
    if (user) {
      try {
        const res: unknown = await api.post('/favorites/add', { item_id: id, item_type: type });
        const status = res && typeof res === 'object' ? (res as { status?: unknown }).status : undefined;
        if (status === 'exists') result = 'exists';
      } catch (e) {
        console.error('[FavoritesContext] ensureFavorite failed', e);
        return 'failed';
      }
    }
    const newFavs = already ? favorites : [...favorites, { item_id: id, item_type: type }];
    setFavorites(prev => (prev.some(f => f.item_id === id) ? prev : [...prev, { item_id: id, item_type: type }]));
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newFavs));
    } catch (e) {
      console.error('[FavoritesContext] persist favorites failed', e);
    }
    if (!already) await scheduleProfileRebuild(newFavs);
    return result;
  }, [favorites, user, scheduleProfileRebuild]);

  return (
    <FavContext.Provider value={{ favorites, isFavorite, toggleFavorite, ensureFavorite, refreshFavorites: loadFavorites }}>
      {children}
    </FavContext.Provider>
  );
}
