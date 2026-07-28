/**
 * "Locals recommend" data — which venues locals favor.
 *
 * Behavioral picks (distinct local users ≥ gate) come with a `local_count`;
 * editorial `local_favorite`-tagged venues fill the baseline so the filter is
 * never empty. Fetched once from the backend and cached for the session; fails
 * soft to an empty set so Explore degrades to normal browsing on any error.
 */
import { useEffect, useState } from 'react';
import { api } from '../constants/api';

export type LocalPick = {
  partner_id: string;
  source: 'behavioral' | 'tag';
  local_count?: number;
  lift?: number;
  neighborhood?: string | null;
};

export type LocalPicksData = {
  ids: Set<string>;
  byId: Map<string, LocalPick>;
  behavioralCount: number;
};

const EMPTY: LocalPicksData = { ids: new Set(), byId: new Map(), behavioralCount: 0 };

let _cache: LocalPicksData | null = null;
let _inflight: Promise<LocalPicksData> | null = null;

export async function getLocalPicks(): Promise<LocalPicksData> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const data = await api.get('/local-picks');
      const picks: LocalPick[] = Array.isArray(data?.picks) ? data.picks : [];
      const ids = new Set<string>();
      const byId = new Map<string, LocalPick>();
      for (const p of picks) {
        if (!p?.partner_id) continue;
        ids.add(p.partner_id);
        byId.set(p.partner_id, p);
      }
      _cache = { ids, byId, behavioralCount: Number(data?.behavioral_count) || 0 };
      return _cache;
    } catch {
      return EMPTY;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Behavioral local pick for a venue (undefined for tag-only or non-picks). */
export function behavioralPick(data: LocalPicksData, partnerId: string): LocalPick | undefined {
  const p = data.byId.get(partnerId);
  return p && p.source === 'behavioral' ? p : undefined;
}

export function useLocalPicks(): LocalPicksData & { loading: boolean } {
  const [data, setData] = useState<LocalPicksData>(_cache || EMPTY);
  const [loading, setLoading] = useState(!_cache);
  useEffect(() => {
    let alive = true;
    getLocalPicks().then((d) => {
      if (alive) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return { ...data, loading };
}
