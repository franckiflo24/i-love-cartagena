import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../constants/api';

type Tier = 'explorer' | 'voyager' | 'elite' | 'legend';

type PointEvent = {
  history_id: string;
  delta: number;
  balance_after: number;
  action_type: string;
  description: string;
  created_at: string;
};

type Offer = {
  offer_id: string;
  title: string;
  description: string;
  min_tier: string;
  points_cost: number;
  eligible: boolean;
};

type RewardsContextType = {
  tier: Tier;
  tierLabel: string;
  points: number;
  pointsToNext: number;
  nextTier: string;
  progressPct: number;
  benefits: string[];
  recentHistory: PointEvent[];
  offers: Offer[];
  pointsConfig: Record<string, number>;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const DEFAULTS: RewardsContextType = {
  tier: 'explorer',
  tierLabel: 'Explorer',
  points: 0,
  pointsToNext: 0,
  nextTier: '',
  progressPct: 0,
  benefits: [],
  recentHistory: [],
  offers: [],
  pointsConfig: {},
  isLoading: true,
  refresh: async () => {},
};

const RewardsContext = createContext<RewardsContextType>(DEFAULTS);

export const useRewards = () => useContext(RewardsContext);

export function RewardsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tier, setTier] = useState<Tier>('explorer');
  const [tierLabel, setTierLabel] = useState<string>('Explorer');
  const [points, setPoints] = useState<number>(0);
  const [pointsToNext, setPointsToNext] = useState<number>(0);
  const [nextTier, setNextTier] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [benefits, setBenefits] = useState<string[]>([]);
  const [recentHistory, setRecentHistory] = useState<PointEvent[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pointsConfig, setPointsConfig] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setTier('explorer');
      setTierLabel('Explorer');
      setPoints(0);
      setPointsToNext(0);
      setNextTier('');
      setProgressPct(0);
      setBenefits([]);
      setRecentHistory([]);
      setOffers([]);
      setPointsConfig({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.get('/rewards/me');
      setTier(data.tier ?? 'explorer');
      setTierLabel(data.tier_label ?? 'Explorer');
      setPoints(data.points_balance ?? data.points ?? 0);
      setPointsToNext(data.points_to_next ?? 0);
      setNextTier(data.next_tier ?? '');
      setProgressPct(data.progress_pct ?? 0);
      setBenefits(data.benefits ?? []);
      setRecentHistory(data.recent_history ?? []);
      setOffers(data.offers ?? []);
      setPointsConfig(data.points_config ?? {});
    } catch {
      // 401 or network error — leave defaults (Explorer, 0 pts), don't retry
      console.warn('[RewardsContext] /rewards/me unavailable — using defaults');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <RewardsContext.Provider
      value={{
        tier,
        tierLabel,
        points,
        pointsToNext,
        nextTier,
        progressPct,
        benefits,
        recentHistory,
        offers,
        pointsConfig,
        isLoading,
        refresh,
      }}
    >
      {children}
    </RewardsContext.Provider>
  );
}
