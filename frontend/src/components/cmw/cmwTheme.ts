// CMW visual tokens: the printed program's palette (sunset amber, coral, gold,
// white editorial serif) over the app's own dark background. This is NOT the
// app-wide black-and-gold default: every value here comes from the deck's pages
// (cover, calendar, islands) and is used only on CMW surfaces.
//
// Display type: the deck sets its headings in a high-contrast Didone serif. The
// app loads no serif web font (Outfit/Manrope only, see app/+html.tsx) and adds
// no dependency, so headings use the system Didone stack: Didot on iOS/macOS,
// the platform serif on Android, and the equivalent CSS stack on the web.
import { Platform, TextStyle } from 'react-native';
import { COLORS } from '../../constants/theme';

export const CMW = {
  amber: '#F4A43A',
  coral: '#EE6B4D',
  gold: '#F2C979',
  ember: '#C7402A',
  cream: '#FFF3E2',
  /** Warm muted copy on dark. */
  sand: 'rgba(255, 221, 186, 0.74)',
  sandFaint: 'rgba(255, 221, 186, 0.46)',
  /** Card surface, a shade warmer than the app navy so the section reads as its own world. */
  surface: '#14111A',
  surfaceAlt: '#1B1620',
  line: 'rgba(244, 164, 58, 0.20)',
  lineSoft: 'rgba(255, 255, 255, 0.07)',
  glow: 'rgba(244, 164, 58, 0.16)',
  /** Text on an amber → coral fill. */
  onAccent: '#1A0D06',
  background: COLORS.background,
  white: '#FFFFFF',
} as const;

export const CMW_GRADIENT = ['#F6B04A', '#EE6B4D'] as const;
export const CMW_GRADIENT_SOFT = ['rgba(246,176,74,0.22)', 'rgba(238,107,77,0.10)'] as const;

export const CMW_SERIF: string = Platform.select({
  ios: 'Didot',
  android: 'serif',
  default: '"Didot", "Bodoni 72", "Bodoni MT", "Playfair Display", Georgia, "Times New Roman", serif',
}) as string;

/** Serif display roles. Weight stays regular: the deck's serif is thin and tall. */
export const CMW_TYPE = {
  display: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 52, lineHeight: 56, letterSpacing: 2, color: CMW.white } as TextStyle,
  displaySub: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 22, lineHeight: 26, letterSpacing: 6, color: CMW.white } as TextStyle,
  title: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 30, lineHeight: 34, letterSpacing: 0.2, color: CMW.white } as TextStyle,
  h2: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 26, lineHeight: 30, letterSpacing: 0.2, color: CMW.white } as TextStyle,
  h3: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 21, lineHeight: 26, letterSpacing: 0.1, color: CMW.white } as TextStyle,
  dayNumber: { fontFamily: CMW_SERIF, fontWeight: '400', fontSize: 24, lineHeight: 26, color: CMW.white } as TextStyle,
  /** Sans eyebrow above serif headings. */
  eyebrow: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: CMW.amber } as TextStyle,
  body: { fontSize: 14.5, lineHeight: 22, fontWeight: '400', color: CMW.sand } as TextStyle,
  small: { fontSize: 12.5, lineHeight: 17, fontWeight: '500', color: CMW.sandFaint } as TextStyle,
} as const;

export const CMW_GUTTER = 20;
export const CMW_RADIUS = { card: 22, chip: 999, image: 18 } as const;
