/**
 * BrandLoader — the AMO logo as a loading state, so every "loading" moment on the
 * site is branded (matches the landing preloader). The heart imago beats; a full
 * lockup option is used for large full-screen loads. Web-first (Expo static export):
 * images resolve from /brand/*. Falls back to a heartbeat of the red heart.
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, Platform } from 'react-native';

type Props = {
  /** Fill the screen on a dark ground (initial screen loads). */
  fullscreen?: boolean;
  /** Show the full AMO ❤ lockup instead of just the heart. */
  lockup?: boolean;
  /** Heart size in px (ignored when lockup). */
  size?: number;
};

// On web the static export serves these from /brand; RN Image accepts a uri source.
const HEART = { uri: '/brand/amo-heart-512.png' } as const;
const LOCKUP = { uri: '/brand/amo-logo-lockup.png' } as const;

export function BrandLoader({ fullscreen = false, lockup = false, size = 96 }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    // Heartbeat: two quick pulses then a rest — the brand's signature beat.
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.14, duration: 260, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(scale, { toValue: 1.0, duration: 220, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
        Animated.timing(scale, { toValue: 1.09, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(scale, { toValue: 1.0, duration: 220, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
        Animated.delay(620),
      ]),
    );
    beat.start();
    return () => beat.stop();
  }, [scale, fade]);

  const src = lockup ? LOCKUP : HEART;
  const dims = lockup
    ? { width: Math.min(size * 3.2, 280), height: Math.min(size * 3.2, 280) * (267 / 760) }
    : { width: size, height: size };

  return (
    <View style={[styles.wrap, fullscreen && styles.fullscreen]}>
      <Animated.Image
        source={src}
        resizeMode="contain"
        accessibilityLabel="AMO"
        style={[dims, { opacity: fade, transform: [{ scale }] }] as any}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  fullscreen: {
    flex: 1,
    backgroundColor: '#020408',
    ...(Platform.OS === 'web' ? { minHeight: '60vh' as any } : { minHeight: 400 }),
  },
});

export default BrandLoader;
