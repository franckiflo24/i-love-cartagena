import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { api } from '../constants/api';

const STORAGE_KEY = '@amocartagena_calendar';

export type CalendarItem = {
  item_id: string;
  item_type: 'event' | 'partner_event' | 'concert';
  date: string;       // YYYY-MM-DD
  start_time?: string;
  end_time?: string;
  title?: string;
  flyer_url?: string;
  category?: string;
  partner_name?: string;
  partner_tier?: string;
  is_free?: boolean;
  price?: number;
  source?: 'manual' | 'reservation';
  added_at: string;
};

interface CalendarContextType {
  items: CalendarItem[];
  isInCalendar: (id: string) => boolean;
  addToCalendar: (item: Omit<CalendarItem, 'added_at'>) => Promise<void>;
  removeFromCalendar: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<CalendarContextType | null>(null);

export function MyCalendarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CalendarItem[]>([]);

  const load = useCallback(async () => {
    try {
      if (user) {
        try {
          const remote = await api.get('/calendar');
          const safeRemote = Array.isArray(remote) ? remote : [];
          setItems(safeRemote);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(safeRemote));
          return;
        } catch (e) { console.error('[MyCalendarContext] remote load failed, falling back to local', e); }
      }
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) { try { const p = JSON.parse(stored); if (Array.isArray(p)) setItems(p); } catch { /* malformed stored calendar data */ } }
    } catch (e) { console.error('Calendar load error', e); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const isInCalendar = useCallback((id: string) => {
    if (!id || !Array.isArray(items)) return false;
    return items.some(i => i.item_id === id);
  }, [items]);

  const addToCalendar = useCallback(async (item: Omit<CalendarItem, 'added_at'>) => {
    if (!Array.isArray(items)) return;
    const exists = items.some(i => i.item_id === item.item_id);
    if (exists) return;
    const newItem: CalendarItem = { ...item, added_at: new Date().toISOString() };
    const next = [...items, newItem];
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (user) {
      try { await api.post('/calendar', newItem); } catch (e) { console.error('add cal sync', e); }
    }
  }, [items, user]);

  const removeFromCalendar = useCallback(async (id: string) => {
    const next = items.filter(i => i.item_id !== id);
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (user) {
      try { await api.delete(`/calendar/${id}`); } catch (e) { console.error('rm cal sync', e); }
    }
  }, [items, user]);

  return (
    <Ctx.Provider value={{ items, isInCalendar, addToCalendar, removeFromCalendar, refresh: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMyCalendar() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMyCalendar must be used within MyCalendarProvider');
  return c;
}
