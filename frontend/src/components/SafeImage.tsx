import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ImageStyle, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image as ExpoImage, ImageContentFit } from 'expo-image';
import { getBundledPlaceholder, getCategoryImage } from '../constants/images';
import { ASSET_ORIGIN } from '../constants/api';
import { COLORS } from '../constants/theme';

// Root-relative asset paths ('/images/...') have no origin on native — a bare
// '/images/x.jpg' fetch dies in a binary, so every self-hosted partner/event/
// hero photo rendered as the gray placeholder on iOS. Prepend ASSET_ORIGIN
// ('' on web = no-op; production site on native). http/https/data: pass through.
const absUri = (u: string): string => (u && u.startsWith('/') ? ASSET_ORIGIN + u : (u || ''));

type ResizeMode = 'cover' | 'contain' | 'stretch' | 'center' | 'repeat';
const FIT_FOR_RESIZE: Record<ResizeMode, ImageContentFit> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  center: 'none',
  repeat: 'cover',
};

export type SafeImageProps = {
  uri?: string | null;
  category?: string | null;
  fallbackUri?: string | null;
  style?: StyleProp<ImageStyle>;
  /** RN <Image> compat; prefer `contentFit`. */
  resizeMode?: ResizeMode;
  contentFit?: ImageContentFit;
  /** Queue priority: 'high' for the hero / first visible cards, 'low' for grids. */
  priority?: 'low' | 'normal' | 'high';
  /** Crossfade ms between placeholder and photo (0 = instant). */
  transition?: number;
  blurRadius?: number;
  accessibilityLabel?: string;
  testID?: string;
  onLoad?: () => void;
  onError?: () => void;
};

// A source is either a remote/absolute URL string or a bundled asset id (require()).
type Src = string | number;
// 0 = primary uri, 1 = fallbackUri, 2 = self-hosted category photo (web only), 3 = bundled
type Stage = 0 | 1 | 2 | 3;

const SHEEN_DURATION = 900;
const SHEEN_MIN = 0.03;
const SHEEN_MAX = 0.10;

const isLoadable = (u?: string | null): u is string =>
  !!u && (u.startsWith('http') || u.startsWith('/') || u.startsWith('data:') || u.startsWith('file:'));

function resolveInitial(uri: string | null | undefined, fallbackUri: string | null | undefined, category: string | null | undefined): { src: Src; stage: Stage } {
  if (isLoadable(uri)) return { src: uri, stage: 0 };
  if (isLoadable(fallbackUri)) return { src: fallbackUri, stage: 1 };
  // Web is same-origin and fast: the self-hosted category photo is a nicer
  // empty state. Native goes straight to the bundled card — no queue, no origin.
  if (Platform.OS === 'web') return { src: getCategoryImage(category), stage: 2 };
  return { src: getBundledPlaceholder(category), stage: 3 };
}

/**
 * The one image primitive for every remote photo in the app (never use a raw
 * <Image> for data-driven URLs). Built on expo-image: disk cache that survives
 * `max-age=0`, load priority, cancel-on-unmount, and a REAL placeholder.
 *
 * What the user sees, in order:
 *   frame 0  → bundled branded placeholder for the category (in the binary via
 *              require(); zero network — a loading tile is never a black box)
 *   loading  → a faint sheen pulses over the placeholder
 *   loaded   → the photo crossfades in
 *
 * Fallback chain when a source fails (4xx, network, expired CDN):
 *   1. `uri`  → 2. `fallbackUri`  → 3. category photo (web only)  → 4. bundled
 * Stage 4 is local, so the chain ALWAYS ends on something painted.
 *
 * WEB EXCEPTION (deliberate): stage 3 is a same-origin `/images/categories/*.jpg`
 * fetch — a nicer empty state than the branded card, and it costs nothing on
 * the static site. NATIVE never reaches a network stage beyond the caller's own
 * uri/fallbackUri: it has no origin, so stage 3 is skipped and the chain ends on
 * the bundled placeholder. "Never falls back to a network URL" holds for the
 * binary; on web the only network fallback is our own origin.
 */
export function SafeImage({
  uri,
  category,
  fallbackUri,
  style,
  resizeMode,
  contentFit,
  priority = 'normal',
  transition = 180,
  blurRadius,
  accessibilityLabel,
  testID,
  onLoad,
  onError,
}: SafeImageProps) {
  const initial = useMemo(() => resolveInitial(uri, fallbackUri, category), [uri, fallbackUri, category]);
  const placeholder = useMemo(() => getBundledPlaceholder(category), [category]);
  const [src, setSrc] = useState<Src>(initial.src);
  const [stage, setStage] = useState<Stage>(initial.stage);
  const [settled, setSettled] = useState(false);

  const sheen = useRef(new Animated.Value(SHEEN_MIN)).current;
  const sheenVisible = useRef(new Animated.Value(1)).current;

  // Parent passed a new uri/fallback/category → restart the chain.
  useEffect(() => {
    setSrc(initial.src);
    setStage(initial.stage);
    setSettled(false);
    sheenVisible.setValue(1);
  }, [initial, sheenVisible]);

  // Pulse only while something is still loading — dozens of tiles in a grid
  // must not keep a loop alive after their photo is on screen.
  useEffect(() => {
    if (settled) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, { toValue: SHEEN_MAX, duration: SHEEN_DURATION, useNativeDriver: true }),
        Animated.timing(sheen, { toValue: SHEEN_MIN, duration: SHEEN_DURATION, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [settled, sheen]);

  const finish = useCallback(() => {
    setSettled(true);
    Animated.timing(sheenVisible, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, [sheenVisible]);

  const handleLoad = useCallback(() => {
    finish();
    if (onLoad) onLoad();
  }, [finish, onLoad]);

  const handleError = useCallback(() => {
    let next: { src: Src; stage: Stage } | null = null;
    if (stage === 0 && isLoadable(fallbackUri) && fallbackUri !== src) {
      next = { src: fallbackUri, stage: 1 };
    } else if (stage <= 1 && Platform.OS === 'web') {
      const cat = getCategoryImage(category);
      if (cat !== src) next = { src: cat, stage: 2 };
    }
    if (!next && stage <= 2) next = { src: placeholder, stage: 3 };
    if (next) {
      setSrc(next.src);
      setStage(next.stage);
      return;
    }
    // Even the bundled asset failed (should be impossible) — stop pulsing and
    // leave the placeholder layer visible; surface it to the caller.
    finish();
    if (onError) onError();
  }, [stage, src, fallbackUri, category, placeholder, finish, onError]);

  const fit: ImageContentFit = contentFit ?? (resizeMode ? FIT_FOR_RESIZE[resizeMode] : 'cover');
  const source = typeof src === 'number' ? src : { uri: absUri(src) };
  const recyclingKey = typeof src === 'number' ? `bundled:${src}` : src;

  return (
    <View style={[styles.container, style as StyleProp<ViewStyle>]} testID={testID}>
      <ExpoImage
        source={source}
        placeholder={placeholder}
        placeholderContentFit="cover"
        contentFit={fit}
        transition={transition}
        cachePolicy="memory-disk"
        priority={priority}
        recyclingKey={recyclingKey}
        blurRadius={blurRadius}
        accessibilityLabel={accessibilityLabel}
        onLoad={handleLoad}
        onError={handleError}
        style={styles.image}
      />
      {/* Loading sheen — a faint pulse over the placeholder so a loading tile
          reads as alive, then fades out on load. Never darkens a loaded photo. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.sheen,
          { opacity: Animated.multiply(sheen, sheenVisible) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    // Lifted navy (not the page background) so a tile is a tile even in the
    // milliseconds before the bundled placeholder decodes.
    backgroundColor: COLORS.surfaceAlt,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  sheen: {
    backgroundColor: COLORS.white,
  },
});

export default SafeImage;
