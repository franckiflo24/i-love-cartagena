import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleProp, ViewStyle } from 'react-native';
import { MOTION } from '../constants/theme';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Stagger delay (ms) — sequence a group by passing 0, 60, 120… */
  delay?: number;
  /** Rise distance (px) the content travels up as it fades in. */
  distance?: number;
  /** Animation duration (ms). */
  duration?: number;
};

/**
 * Apple-grade entrance: children fade + rise into place on mount.
 *
 * SELF-HEALING (see the .reveal opacity:0 trap — content stuck hidden when an
 * animation freezes in a backgrounded tab): a failsafe timer force-reveals the
 * content after the animation's own budget, swapping to a static, fully-visible
 * render that has NO animation dependency. Content can never get stuck hidden.
 *
 * Server/first-client render both start at progress 0 (opacity 0, translated),
 * so hydration matches — no React #418. Uses RN core Animated (Reanimated is
 * installed but unconfigured); useNativeDriver is off on web where layout/opacity
 * can't be native-driven.
 */
export function FadeInUp({
  children,
  style,
  delay = 0,
  distance = 16,
  duration = MOTION.duration.slow,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [healed, setHealed] = useState(false);

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: MOTION.easing.decelerate,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    // Force-reveal after the animation's full budget + buffer, no matter what.
    const failsafe = setTimeout(() => setHealed(true), delay + duration + 400);
    return () => {
      anim.stop();
      clearTimeout(failsafe);
    };
  }, [progress, delay, duration]);

  if (healed) {
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export default FadeInUp;
