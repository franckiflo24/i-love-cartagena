import React, { useRef } from 'react';
import { Animated, Pressable, Platform, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';
import { MOTION } from '../constants/theme';

type Props = {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Fires a light haptic on press-in (native only). Reserve for commit actions. */
  haptic?: boolean;
  accessibilityRole?: any;
  accessibilityLabel?: string;
  hitSlop?: any;
  testID?: string;
};

/**
 * Apple-grade press feedback: a subtle spring scale on press. The scale transform
 * is layout-neutral (doesn't reflow), useNativeDriver is a no-op on web, and this
 * forwards the props real buttons need. Use on cards/CTAs — NOT inside FlatList
 * rows where it could fight horizontal scroll drag.
 */
export function PressableScale({
  children, onPress, onLongPress, disabled, style, haptic,
  accessibilityRole = 'button', accessibilityLabel, hitSlop, testID,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      tension: MOTION.spring.tension,
      friction: MOTION.spring.friction,
      useNativeDriver: true,
    }).start();

  const onPressIn = () => {
    to(MOTION.pressScale);
    if (haptic && Platform.OS !== 'web') {
      // Lazy + guarded so a missing module never crashes the press.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Haptics = require('expo-haptics');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch { /* haptics optional */ }
    }
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={() => to(1)}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      testID={testID}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default PressableScale;
