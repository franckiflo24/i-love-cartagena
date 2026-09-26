// Native no-op twin of WebHead.web.tsx. expo-router/head rendered on iOS/Android pops an
// "Expo Head: Add the handoff origin to the Expo Config" alert on EVERY screen unless the
// router plugin carries a Handoff `origin` — we only need <title> on web, so Metro resolves
// the .web file there and this null component in the binaries.
import type { ReactNode } from 'react';

export default function WebHead(_props: { children?: ReactNode }): null {
  return null;
}
