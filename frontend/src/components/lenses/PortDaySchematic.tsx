/**
 * PortDaySchematic — the offline stop map for Port Day itineraries
 * (docs/lenses/DESIGN.md §4: "SVG projection from bundled coords; no tile dependency").
 *
 * Pure react-native-svg. The stops' lat/lng are projected linearly (north up, ONE uniform
 * scale, longitude shrunk by cos(lat) so the drawing keeps its real proportions) into a
 * padded viewBox and joined by a dashed 2 px polyline in visiting order; every stop is a
 * numbered circle and the first one is accent-colored. Circles that would land on top of
 * each other (Torre del Reloj and Portal de los Dulces are ~45 m apart) are nudged apart
 * so every number stays legible — this is a schematic, not a survey.
 *
 * No tiles, no network, no Leaflet: it draws from the coordinates already in the bundle,
 * so it works in airplane mode. The projection is a pure function of the props (no clock,
 * no window, no Dimensions), so the server render and the first client render are
 * identical — no hydration drift. The <Svg> scales to its container through viewBox.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, RADIUS } from '../../constants/theme';
import { useTr } from '../../i18n/autoTr';

export interface SchematicStop {
  name: string;
  lat: number;
  lng: number;
  minutes: number;
}

interface Props {
  stops: SchematicStop[];
  height?: number;
}

export interface Point {
  x: number;
  y: number;
}

const VB_W = 340;          // logical drawing width; the <Svg> scales it to its container
const PAD_X = 30;
const PAD_Y = 26;
const NODE_R = 10;
const MIN_GAP = NODE_R * 2 + 20;  // centre-to-centre; leaves >= 20 px of dashed path visible between neighbours
const EPS = 1e-9;
const DEFAULT_HEIGHT = 230;
const MIN_HEIGHT = 120;
const GRID = 34;
const GRID_COLOR = 'rgba(255,255,255,0.05)';
const FIRST_FILL = COLORS.mustard;
const FIRST_TEXT = '#1A1206';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Push apart every pair closer than `minGap` (iterated, then clamped to the box).
 * Deterministic: coincident points separate along a fixed golden-angle direction
 * keyed on the pair's indices, so identical input always gives identical output.
 * Points that are already far enough apart never move.
 */
function spreadPoints(input: Point[], minGap: number, box: { x0: number; y0: number; x1: number; y1: number }): Point[] {
  const p = input.map((q) => ({ x: q.x, y: q.y }));
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        let dx = p[j].x - p[i].x;
        let dy = p[j].y - p[i].y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d >= minGap) continue;
        if (d < 1e-6) {
          const a = (i * 7 + j + 1) * 2.399963;
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const push = (minGap - d) / 2 + 0.05;
        const ux = dx / d;
        const uy = dy / d;
        p[i].x -= ux * push;
        p[i].y -= uy * push;
        p[j].x += ux * push;
        p[j].y += uy * push;
        moved = true;
      }
    }
    for (const q of p) {
      q.x = clamp(q.x, box.x0, box.x1);
      q.y = clamp(q.y, box.y0, box.y1);
    }
    if (!moved) break;
  }
  return p;
}

/**
 * Project stops into a `width` x `height` box. Returns one entry per input stop
 * (null where a stop has non-finite coordinates, so numbering never shifts).
 *  - 1 stop, identical coordinates, or a perfectly straight N-S / E-W line: a zero
 *    span never divides by zero — the drawing is simply centred on that axis.
 *  - lat axis inverts for screen y (north up).
 */
export function projectStops(
  stops: ReadonlyArray<{ lat: number; lng: number }>,
  width: number,
  height: number,
): Array<Point | null> {
  const out: Array<Point | null> = stops.map(() => null);
  const valid: number[] = [];
  stops.forEach((s, i) => {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) valid.push(i);
  });
  if (valid.length === 0) return out;

  const x0 = PAD_X;
  const x1 = Math.max(width - PAD_X, x0 + 1);
  const y0 = PAD_Y;
  const y1 = Math.max(height - PAD_Y, y0 + 1);
  const innerW = x1 - x0;
  const innerH = y1 - y0;

  const meanLat = valid.reduce((sum, i) => sum + stops[i].lat, 0) / valid.length;
  const k = Math.cos((meanLat * Math.PI) / 180);        // a degree of lng is shorter away from the equator
  const gx = valid.map((i) => stops[i].lng * k);        // east  -> +x
  const gy = valid.map((i) => -stops[i].lat);           // north -> smaller y
  const minX = Math.min(...gx);
  const maxX = Math.max(...gx);
  const minY = Math.min(...gy);
  const maxY = Math.max(...gy);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const scale = spanX < EPS && spanY < EPS
    ? 0
    : Math.min(innerW / Math.max(spanX, EPS), innerH / Math.max(spanY, EPS));
  const offX = x0 + (innerW - spanX * scale) / 2;
  const offY = y0 + (innerH - spanY * scale) / 2;

  const raw: Point[] = valid.map((_, j) => ({
    x: offX + (gx[j] - minX) * scale,
    y: offY + (gy[j] - minY) * scale,
  }));
  const spread = spreadPoints(raw, MIN_GAP, { x0, y0, x1, y1 });
  valid.forEach((i, j) => {
    out[i] = spread[j];
  });
  return out;
}

const fmt = (n: number): string => n.toFixed(1);

export function PortDaySchematic({ stops, height = DEFAULT_HEIGHT }: Props) {
  const tr = useTr();
  const h = Math.max(MIN_HEIGHT, Number.isFinite(height) ? height : DEFAULT_HEIGHT);
  const list = Array.isArray(stops) ? stops : [];
  const pts = useMemo(() => projectStops(list, VB_W, h), [list, h]);

  const drawn = pts.filter((p): p is Point => p !== null);
  const linePoints = drawn.length >= 2 ? drawn.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ') : null;

  const gridX: number[] = [];
  for (let x = GRID; x < VB_W; x += GRID) gridX.push(x);
  const gridY: number[] = [];
  for (let y = GRID; y < h; y += GRID) gridY.push(y);

  const minLabel = tr('min');
  const a11y = list
    .map((s, i) => `${i + 1}. ${s.name}${Number.isFinite(s.minutes) ? ` · ${s.minutes} ${minLabel}` : ''}`)
    .join('; ');

  return (
    <View style={styles.wrap} testID="port-day-schematic">
      <View style={[styles.frame, { height: h }]} accessible accessibilityRole="image" accessibilityLabel={a11y}>
        <Svg width="100%" height={h} viewBox={`0 0 ${VB_W} ${h}`} preserveAspectRatio="xMidYMid meet">
          {gridX.map((x) => (
            <Line key={`gx${x}`} x1={x} y1={0} x2={x} y2={h} stroke={GRID_COLOR} strokeWidth={1} />
          ))}
          {gridY.map((y) => (
            <Line key={`gy${y}`} x1={0} y1={y} x2={VB_W} y2={y} stroke={GRID_COLOR} strokeWidth={1} />
          ))}
          {linePoints ? (
            <Polyline
              points={linePoints}
              fill="none"
              stroke={COLORS.primary}
              strokeOpacity={0.8}
              strokeWidth={2}
              strokeDasharray="6 5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {pts.map((p, i) => {
            if (!p) return null;
            const first = i === 0;
            return (
              <React.Fragment key={`n${i}`}>
                <Circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill={first ? FIRST_FILL : COLORS.surfaceAlt}
                  stroke={first ? FIRST_FILL : COLORS.primary}
                  strokeWidth={2}
                />
                <SvgText
                  x={p.x}
                  y={p.y + 4}
                  fontSize={11}
                  fontWeight="700"
                  fill={first ? FIRST_TEXT : COLORS.textMain}
                  textAnchor="middle"
                >
                  {String(i + 1)}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
      <Text style={styles.caption}>{tr('Mapa esquemático — funciona sin datos')}</Text>
    </View>
  );
}

export default PortDaySchematic;

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  frame: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    overflow: 'hidden',
  },
  caption: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 15,
    color: COLORS.textFaint,
    ...FONTS.regular,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
