import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

const KEYS = {
  ONBOARDING_PROFILE: '@onboarding_profile',
  ONBOARDING_DONE: '@onboarding_done',
  PROFILE_COMPLETED: '@profile_completed',
  PROFILE_DATA: '@profile_data',
  PERSONALIZATION: '@personalization_profile',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingProfile {
  user_type: 'visitor' | 'local';
  travel_dates: { start: string; end: string } | null;
  party_type: 'solo' | 'couple' | 'family' | 'friends' | 'cruise' | null;
  interests: string[];
  skipped_steps: string[];
}

export interface UserProfile {
  isPersonalized: boolean;
  userType: 'visitor' | 'local' | null;
  travelDates: { start: string; end: string } | null;
  partyType: string | null;
  interests: string[];
  nationality: string | null;
  ageGroup: string | null;
  musicPreferences: string[];
}

/** Minimum shape a partner object must satisfy for personalization scoring. */
export interface PartnerLike {
  category: string;
  subcategory?: string;
  tier?: string;
  rating?: number;
  [key: string]: unknown;
}

export interface ExploreCategory {
  key: string;
  label: string;
}

/** Minimum shape for items passed to getPersonalizedCategories. Must have a category key. */
interface CategoryLike {
  cat?: string;
  key?: string;
  [key: string]: unknown;
}

type PersonalizationContextType = {
  userProfile: UserProfile;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;
  getPersonalizedPartners: <T extends PartnerLike>(partners: T[]) => T[];
  getPersonalizedCategories: {
    (): ExploreCategory[];
    <T extends CategoryLike>(items: T[]): T[];
  };
  getGreeting: () => string;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE: UserProfile = {
  isPersonalized: false,
  userType: null,
  travelDates: null,
  partyType: null,
  interests: [],
  nationality: null,
  ageGroup: null,
  musicPreferences: [],
};

const DEFAULT_CATEGORIES: ExploreCategory[] = [
  { key: 'restaurant', label: 'Restaurante' },
  { key: 'bar', label: 'Bar' },
  { key: 'beach_club', label: 'Beach Club' },
  { key: 'club', label: 'Club' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'spa', label: 'Spa' },
  { key: 'cafe', label: 'Cafe' },
  { key: 'activity', label: 'Experiencia' },
];

// ---------------------------------------------------------------------------
// Scoring Configuration
// ---------------------------------------------------------------------------

const SCORE = {
  CATEGORY_MATCH: 5,
  SUBCATEGORY_MATCH: 3,
  TIER_BONUS_ELITE: 2,
  TIER_BONUS_GOLD: 2,
  TIER_BONUS_PREMIUM: 1,
  HIGH_RATING: 1,
  RATING_THRESHOLD: 4.2,
  USER_TYPE_BOOST: 3,
  PARTY_TYPE_BOOST: 2,
} as const;

const VISITOR_BOOST_CATEGORIES = new Set(['beach_club', 'hotel', 'activity', 'tour']);
const LOCAL_BOOST_CATEGORIES = new Set(['restaurant', 'bar', 'cafe', 'spa']);

const PARTY_TYPE_BOOSTS: Record<string, Set<string>> = {
  couple: new Set(['spa', 'restaurant', 'hotel']),
  friends: new Set(['bar', 'club', 'beach_club']),
  family: new Set(['restaurant', 'activity', 'hotel', 'cafe']),
  cruise: new Set(['beach_club', 'activity', 'restaurant', 'tour']),
  solo: new Set(['cafe', 'spa', 'activity', 'bar']),
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PersonalizationContext = createContext<PersonalizationContextType>({
  userProfile: DEFAULT_PROFILE,
  hasCompletedOnboarding: false,
  isLoading: true,
  getPersonalizedPartners: <T extends PartnerLike>(partners: T[]) => partners,
  getPersonalizedCategories: ((...args: unknown[]) => {
    if (args.length > 0 && Array.isArray(args[0])) return args[0];
    return DEFAULT_CATEGORIES;
  }) as PersonalizationContextType['getPersonalizedCategories'],
  getGreeting: () => 'Bienvenido',
  updateProfile: async () => {},
});

export const usePersonalization = () => useContext(PersonalizationContext);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PersonalizationProvider({ children }: { children: React.ReactNode }) {
  const [userProfile, setUserProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const profileRef = useRef<UserProfile>(DEFAULT_PROFILE);

  // Keep ref in sync for stable callback closures
  useEffect(() => {
    profileRef.current = userProfile;
  }, [userProfile]);

  // ── Load preferences from AsyncStorage on mount ──────────────────────
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const [onboardingRaw, onboardingDone, profileCompletedFlag, profileDataRaw, persistedRaw] =
          await Promise.all([
            AsyncStorage.getItem(KEYS.ONBOARDING_PROFILE),
            AsyncStorage.getItem(KEYS.ONBOARDING_DONE),
            AsyncStorage.getItem(KEYS.PROFILE_COMPLETED),
            AsyncStorage.getItem(KEYS.PROFILE_DATA),
            AsyncStorage.getItem(KEYS.PERSONALIZATION),
          ]);

        const completed = onboardingDone === 'true';
        setHasCompletedOnboarding(completed);

        // Start from persisted merged profile if available
        let merged: UserProfile = { ...DEFAULT_PROFILE };
        if (persistedRaw) {
          try {
            const persisted = JSON.parse(persistedRaw) as Partial<UserProfile>;
            merged = { ...merged, ...persisted };
          } catch {
            // Corrupted persisted data — continue with defaults
          }
        }

        // Layer onboarding profile on top
        if (onboardingRaw) {
          try {
            const onboarding = JSON.parse(onboardingRaw) as OnboardingProfile;
            merged.userType = onboarding.user_type || merged.userType;
            merged.travelDates = onboarding.travel_dates || merged.travelDates;
            merged.partyType = onboarding.party_type || merged.partyType;
            if (Array.isArray(onboarding.interests) && onboarding.interests.length > 0) {
              merged.interests = onboarding.interests;
            }
          } catch {
            // Malformed onboarding data — continue with what we have
          }
        }

        // Layer complete-profile data on top
        if (profileCompletedFlag === 'true' && profileDataRaw) {
          try {
            const profileData = JSON.parse(profileDataRaw) as Record<string, unknown>;
            if (typeof profileData.nationality === 'string') {
              merged.nationality = profileData.nationality;
            }
            if (typeof profileData.age_group === 'string') {
              merged.ageGroup = profileData.age_group;
            }
            if (Array.isArray(profileData.music_preferences)) {
              merged.musicPreferences = profileData.music_preferences as string[];
            }
          } catch {
            // Malformed profile data — continue
          }
        }

        // Mark as personalized if we have meaningful preferences
        merged.isPersonalized =
          completed ||
          merged.userType !== null ||
          merged.interests.length > 0 ||
          merged.partyType !== null;

        setUserProfile(merged);
      } catch (e) {
        console.error('[PersonalizationContext] loadProfile failed', e);
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, []);

  // ── Score a single partner against user preferences ──────────────────
  const scorePartner = useCallback((partner: PartnerLike, profile: UserProfile): number => {
    let score = 0;
    const category = (partner.category || '').toLowerCase();
    const subcategory = (partner.subcategory || '').toLowerCase();
    const tier = (partner.tier || '').toLowerCase();
    const interests = profile.interests.map((i) => i.toLowerCase());

    // Direct interest match on category
    if (interests.includes(category)) {
      score += SCORE.CATEGORY_MATCH;
    }

    // Subcategory match against interests
    if (subcategory && interests.includes(subcategory)) {
      score += SCORE.SUBCATEGORY_MATCH;
    }

    // Tier bonus — higher-tier partners surface above same-score peers
    if (tier === 'elite') {
      score += SCORE.TIER_BONUS_ELITE;
    } else if (tier === 'gold') {
      score += SCORE.TIER_BONUS_GOLD;
    } else if (tier === 'premium') {
      score += SCORE.TIER_BONUS_PREMIUM;
    }

    // High-rating bonus
    if (typeof partner.rating === 'number' && partner.rating >= SCORE.RATING_THRESHOLD) {
      score += SCORE.HIGH_RATING;
    }

    // User type contextual boost
    if (profile.userType === 'visitor' && VISITOR_BOOST_CATEGORIES.has(category)) {
      score += SCORE.USER_TYPE_BOOST;
    } else if (profile.userType === 'local' && LOCAL_BOOST_CATEGORIES.has(category)) {
      score += SCORE.USER_TYPE_BOOST;
    }

    // Party type contextual boost
    if (profile.partyType) {
      const boostSet = PARTY_TYPE_BOOSTS[profile.partyType];
      if (boostSet && boostSet.has(category)) {
        score += SCORE.PARTY_TYPE_BOOST;
      }
    }

    return score;
  }, []);

  // ── Public: sort partners by relevance ───────────────────────────────
  const getPersonalizedPartners = useCallback(
    <T extends PartnerLike>(partners: T[]): T[] => {
      const profile = profileRef.current;

      // No personalization — return as-is
      if (!profile.isPersonalized) {
        return partners;
      }

      // Score and sort — stable sort preserves original order for equal scores
      const scored = partners.map((partner) => ({
        partner,
        score: scorePartner(partner, profile),
      }));

      scored.sort((a, b) => b.score - a.score);

      return scored.map((s) => s.partner);
    },
    [scorePartner],
  );

  // ── Public: reorder explore categories by user interests ─────────────
  // Overload 1: no args — returns default ExploreCategory[]
  // Overload 2: pass custom items with `cat` or `key` field — returns them sorted
  const getPersonalizedCategories = useCallback(
    <T extends CategoryLike>(...args: [T[]] | []): ExploreCategory[] | T[] => {
      const profile = profileRef.current;
      const interestsLower = profile.interests.map((i) => i.toLowerCase());

      // Overload: caller passed their own category items
      if (args.length > 0 && Array.isArray(args[0])) {
        const items = args[0];
        if (!profile.isPersonalized || interestsLower.length === 0) {
          return items;
        }

        // Build a priority map: interest -> index (lower = higher priority)
        const priorityMap = new Map<string, number>();
        interestsLower.forEach((interest, idx) => priorityMap.set(interest, idx));

        const sorted = [...items].sort((a, b) => {
          const keyA = (a.cat || a.key || '').toLowerCase();
          const keyB = (b.cat || b.key || '').toLowerCase();
          const prioA = priorityMap.has(keyA) ? priorityMap.get(keyA)! : 999;
          const prioB = priorityMap.has(keyB) ? priorityMap.get(keyB)! : 999;
          return prioA - prioB;
        });

        return sorted;
      }

      // Default: return built-in ExploreCategory list
      if (!profile.isPersonalized || interestsLower.length === 0) {
        return DEFAULT_CATEGORIES;
      }

      const categoryMap = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c]));
      const prioritized: ExploreCategory[] = [];
      const usedKeys = new Set<string>();

      for (const interest of interestsLower) {
        const cat = categoryMap.get(interest);
        if (cat && !usedKeys.has(interest)) {
          prioritized.push(cat);
          usedKeys.add(interest);
        }
      }

      for (const cat of DEFAULT_CATEGORIES) {
        if (!usedKeys.has(cat.key)) {
          prioritized.push(cat);
        }
      }

      return prioritized;
    },
    [],
  ) as PersonalizationContextType['getPersonalizedCategories'];

  // ── Public: contextual greeting ──────────────────────────────────────
  const getGreeting = useCallback((): string => {
    const profile = profileRef.current;

    // Party-type greetings take priority (more specific)
    if (profile.partyType === 'couple') {
      return 'Escapada romantica en Cartagena \u{1F491}';
    }
    if (profile.partyType === 'friends') {
      return 'Cartagena con amigos! \u{1F389}';
    }
    if (profile.partyType === 'family') {
      return 'Cartagena en familia \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
    }

    // User type greetings
    if (profile.userType === 'local') {
      return 'Hola, cartagenero! \u{2764}\u{FE0F}';
    }
    if (profile.userType === 'visitor') {
      return 'Bienvenido a Cartagena! \u{1F334}';
    }

    return 'Bienvenido';
  }, []);

  // ── Public: merge and persist profile updates ────────────────────────
  const updateProfile = useCallback(async (data: Partial<UserProfile>): Promise<void> => {
    try {
      const updated: UserProfile = {
        ...profileRef.current,
        ...data,
        // Re-evaluate personalization flag after merge
        isPersonalized:
          data.isPersonalized ??
          profileRef.current.isPersonalized ??
          ((data.userType ?? profileRef.current.userType) !== null ||
           (data.interests ?? profileRef.current.interests).length > 0 ||
           (data.partyType ?? profileRef.current.partyType) !== null),
      };

      setUserProfile(updated);
      await AsyncStorage.setItem(KEYS.PERSONALIZATION, JSON.stringify(updated));
    } catch (e) {
      console.error('[PersonalizationContext] updateProfile failed', e);
    }
  }, []);

  return (
    <PersonalizationContext.Provider
      value={{
        userProfile,
        hasCompletedOnboarding,
        isLoading,
        getPersonalizedPartners,
        getPersonalizedCategories,
        getGreeting,
        updateProfile,
      }}
    >
      {children}
    </PersonalizationContext.Provider>
  );
}
