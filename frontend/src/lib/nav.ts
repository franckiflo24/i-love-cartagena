// Navigation helpers for detail / modal screens.
//
// Why this exists: every detail screen's "home" button used to call
// `router.replace('/(tabs)')`. From a root-stack modal that REPLACES the modal
// with a brand-new `(tabs)` route, so the whole tab navigator is torn down and
// recreated — Home mounted a fresh instance into its section placeholders and
// Explore re-entered its skeleton and re-downloaded every image (the "Home
// shows a skeleton after pressing home" recording). The tab navigator that is
// already alive underneath the modal must simply be REVEALED, never rebuilt.
//
// goHome: dismiss every modal above the tabs (when there is anything to
// dismiss), then `navigate` — which walks back to the existing `(tabs)` route
// when it is in the stack and only pushes it when the app was deep-linked
// straight into a detail screen. Never `replace`.
//
// goBackOr: the honest "back" — pops when there is history, otherwise goes to
// the fallback with the same navigate semantics (a deep-linked modal with no
// history used to leave `router.back()` a no-op).
//
// login.tsx and the sign-out / delete-account path in perfil.tsx keep their
// `replace('/(tabs)')` on purpose: those legitimately reset the whole stack.
import type { Router } from 'expo-router';

type NavHref = Parameters<Router['navigate']>[0];

const TABS_HREF = '/(tabs)' as NavHref;

/** Reveal the existing tab navigator (never recreate it). */
export function goHome(router: Router): void {
  try {
    if (typeof router.canDismiss === 'function' && router.canDismiss()) router.dismissAll();
  } catch (err) {
    // A stack with nothing to dismiss throws on some versions — navigate still lands home.
    console.error('[nav] dismissAll failed', err);
  }
  router.navigate(TABS_HREF);
}

/** Pop when there is history; otherwise navigate to `fallbackHref` (default: the tabs). */
export function goBackOr(router: Router, fallbackHref: string = '/(tabs)'): void {
  let canGoBack = false;
  try { canGoBack = router.canGoBack(); } catch { canGoBack = false; }
  if (canGoBack) { router.back(); return; }
  if (fallbackHref === '/(tabs)') { goHome(router); return; }
  router.navigate(fallbackHref as NavHref);
}
