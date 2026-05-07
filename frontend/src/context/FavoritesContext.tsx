import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { api } from '../constants/api';

type FavItem = { item_id: string; item_type: string };

type FavContextType = {
  favorites: FavItem[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, type: string) => Promise<void>;
  refreshFavorites: () => Promise<void>;
};

const FavContext = createContext<FavContextType>({
  favorites: [],
  isFavorite: () => false,
  toggleFavorite: async () => {},
  refreshFavorites: async () => {},
});

export const useFavorites = () => useContext(FavContext);

const STORAGE_KEY = '@musica_cartagena_favs';

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavItem[]>([]);

  const loadFavorites = useCallback(async () => {
    try {
      if (user) {
        const data = await api.get('/favorites/ids');
        setFavorites(data);
      } else {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) setFavorites(JSON.parse(stored));
      }
    } catch (e) {
      // Fallback to local
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setFavorites(JSON.parse(stored));
    }
  }, [user]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const isFavorite = useCallback((id: string) => {
    return favorites.some(f => f.item_id === id);
  }, [favorites]);

  const toggleFavorite = useCallback(async (id: string, type: string) => {
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

    // Trigger AI profile rebuild (debounced) — fire-and-forget
    try {
      const userRaw = await AsyncStorage.getItem('user_data');
      const cachedUser = userRaw ? JSON.parse(userRaw) : null;
      const userId = cachedUser?.user_id || user?.user_id;
      if (userId && newFavs.length >= 2) {
        // Cancel any prior pending rebuild
        if ((globalThis as any).__profileRebuildTimer) {
          clearTimeout((globalThis as any).__profileRebuildTimer);
        }
        (globalThis as any).__profileRebuildTimer = setTimeout(() => {
          api.post('/profile/build', { user_id: userId, favorites: newFavs }).catch(() => {});
        }, 1500); // debounce: wait 1.5s after last change
      }
    } catch (e) { /* silent */ }
  }, [favorites, user]);

  return (
    <FavContext.Provider value={{ favorites, isFavorite, toggleFavorite, refreshFavorites: loadFavorites }}>
      {children}
    </FavContext.Provider>
  );
}
