// Haptics — fail-soft wrappers around expo-haptics for iOS/Android commit
// moments. The #1 "web wrapper" tell was that the app never buzzed on native,
// even at its peak beat (the stamp slam vibrated on WEB only). Follow Apple
// HIG: reserve haptics for meaningful commit moments (a stamp earned, a
// booking confirmed, a code verified) — NOT every card tap.
//
// Every helper is a no-op on web and swallows its own errors, so callers never
// need a Platform guard or try/catch.
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const native = Platform.OS !== 'web';

export function hapticLight() {
  if (!native) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticMedium() {
  if (!native) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticHeavy() {
  if (!native) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

export function hapticSuccess() {
  if (!native) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticError() {
  if (!native) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function hapticSelection() {
  if (!native) return;
  Haptics.selectionAsync().catch(() => {});
}
