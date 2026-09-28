// Web build only (Metro picks .web.ts). Registers the Ionicons font from the ROOT
// layout so the static render and the browser's first render agree.
//
// Why: @expo/vector-icons decides at construction time whether its font is loaded
// (Font.isLoaded). During the static export nothing had loaded it, so every icon
// rendered as an EMPTY Text; in the browser the tab bar's icons load it before the
// lazily hydrated screen mounts, so that screen's icons rendered the glyph — a
// server/client text mismatch (React #418) on every screen whose first render
// contains an icon (/agenda, /perfil). useFonts on the server marks the font loaded
// for that render and writes its @font-face into the page head (the
// `expo-generated-fonts` style), so the browser sees it as loaded from the first
// render too.
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

export function useWebIconFonts(): void {
  useFonts(Ionicons.font);
}
