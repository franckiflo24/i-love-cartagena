import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, ImageProps, ImageStyle, StyleProp, StyleSheet, View } from 'react-native';
import { getCategoryImage, FALLBACK_SVGS, IMAGES } from '../constants/images';
import { COLORS } from '../constants/theme';

type Props = Omit<ImageProps, 'source' | 'style'> & {
  uri?: string | null;
  category?: string | null;
  fallbackUri?: string;
  style?: StyleProp<ImageStyle>;
};

const SHIMMER_DURATION = 900;
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 0.7;

/**
 * Image that gracefully degrades to a category-appropriate fallback
 * when the remote URL fails to load (4xx, network error, expired CDN).
 *
 * Use this anywhere a remote URL flows in from data. The fallback chain:
 *   1. The provided `uri`
 *   2. On error → `fallbackUri` (if provided)
 *   3. On error → category fallback via getCategoryImage(category) [Unsplash, needs network]
 *   4. On error → FALLBACK_SVGS[category] [inline SVG, works offline, zero network]
 *
 * While the image loads, an animated shimmer is displayed behind it and
 * fades out once `onLoad` fires.
 */
export function SafeImage({ uri, category, fallbackUri, style, onLoad, ...rest }: Props) {
  const isValidUri = uri && (uri.startsWith('http') || uri.startsWith('/'));
  const initial = isValidUri ? uri : (fallbackUri || getCategoryImage(category) || IMAGES.placeholder);
  const [currentUri, setCurrentUri] = useState<string>(initial);
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0); // 0=primary, 1=fallbackUri, 2=category, 3=inline-svg

  // Shimmer animation refs
  const shimmerOpacity = useRef(new Animated.Value(OPACITY_MIN)).current;
  const shimmerVisible = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerOpacity, {
          toValue: OPACITY_MAX,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerOpacity, {
          toValue: OPACITY_MIN,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [shimmerOpacity]);

  // If parent passes a new uri, reset
  useEffect(() => {
    const nextValid = uri && (uri.startsWith('http') || uri.startsWith('/'));
    const next = nextValid ? uri : (fallbackUri || getCategoryImage(category) || IMAGES.placeholder);
    setCurrentUri(next);
    setStage(0);
    shimmerVisible.setValue(1);
  }, [uri, category, fallbackUri]);

  const handleLoad = (e: any) => {
    Animated.timing(shimmerVisible, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
    if (onLoad) onLoad(e);
  };

  const onError = () => {
    if (stage === 0 && fallbackUri && fallbackUri !== currentUri) {
      setCurrentUri(fallbackUri);
      setStage(1);
      return;
    }
    if (stage <= 1) {
      const catFb = getCategoryImage(category);
      if (catFb && catFb !== currentUri) {
        setCurrentUri(catFb);
        setStage(2);
        return;
      }
    }
    if (stage <= 2) {
      // Inline SVG — works with zero network. Keyed by category, or generic placeholder.
      const catKey = category ? category.toLowerCase() : 'placeholder';
      const svgFb = FALLBACK_SVGS[catKey] ?? FALLBACK_SVGS.placeholder;
      if (svgFb && svgFb !== currentUri) {
        setCurrentUri(svgFb);
        setStage(3);
        return;
      }
    }
    // Absolute last resort: static Unsplash placeholder (already tried everything else)
    if (currentUri !== IMAGES.placeholder) {
      setCurrentUri(IMAGES.placeholder);
    }
  };

  return (
    <View style={[shimmerStyles.container, style as any]}>
      {/* Shimmer layer — sits behind the image, fades out once image loads */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          shimmerStyles.shimmer,
          { opacity: Animated.multiply(shimmerOpacity, shimmerVisible) },
        ]}
        pointerEvents="none"
      />
      <Image
        source={{ uri: currentUri }}
        style={shimmerStyles.image}
        onError={onError}
        onLoad={handleLoad}
        {...rest}
      />
    </View>
  );
}

const shimmerStyles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  shimmer: {
    backgroundColor: COLORS.surfaceAlt,
    zIndex: 1,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
});

export default SafeImage;
