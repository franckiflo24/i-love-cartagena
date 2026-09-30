// Port Day (Día de crucero) — the LENSES "kit" screen (docs/lenses/DESIGN.md §4).
//
// Airplane-mode guarantee (V4): the FIRST render is the bundled lenses doc, read
// synchronously — fares, itineraries and the schematic stop map paint with no network.
// loadLenses() then hydrates in an effect and is the ONLY source of the cruise badge
// (port_day.crowd_today): offline it stays null and the badge simply does not exist.
//
// Hydration rule (React #418): nothing clock- or date-dependent renders before `mounted`
// flips in an effect, so the static-export HTML and the first client render are identical
// ("—" placeholders). All hooks sit above any branching; there is no early return.
//
// Return-to-ship countdown: the user sets an all-aboard time (half-hour presets +/- 15 min
// steppers, no native time picker). It is stored as {ymd, hhmm} under @amo_port_allaboard
// for TODAY in Bogotá time, counted down on a 30 s tick, and flagged amber once fewer than
// port_day.return_buffer_min (90) minutes remain.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Head from '../src/components/WebHead';
import PortDaySchematic from '../src/components/lenses/PortDaySchematic';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../src/constants/theme';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';
import { goBackOr } from '../src/lib/nav';
import {
  accessLabel, bundledLenses, lensDef, loadLenses, pickL4,
} from '../src/lib/lenses';
import type {
  AccessTier, FareRow, Itinerary, ItineraryStop, L4, LensesDoc, PortDayKit,
} from '../src/lib/lenses';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type NavHref = Parameters<typeof router.push>[0];

interface AllAboard {
  ymd: string;   // Bogotá calendar date the time was set for, "YYYY-MM-DD"
  hhmm: string;  // 24 h all-aboard time in Bogotá time, "HH:MM"
}

const STORAGE_KEY = '@amo_port_allaboard';
const TICK_MS = 30000;
const DEFAULT_BUFFER_MIN = 90;
const STEP_MIN = 15;
const LAST_MIN_OF_DAY = 23 * 60 + 45;
const PRESET_COLS = 5;
const AMBER = '#F59E0B';
// Colombia has no DST: Bogotá is UTC-5 all year. Plain arithmetic keeps the result
// identical on Hermes, the browser and Node (no Intl / tz-data dependency) and
// independent of the phone's own timezone — an all-aboard time is PORT time.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const minToHhmm = (min: number): string => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

function hhmmToMin(hhmm: string): number | null {
  const m = HHMM_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Bogotá calendar date of an instant. Post-mount only (handlers/effects/derived-from-state). */
function bogotaYmd(ms: number): string {
  const d = new Date(ms - BOGOTA_UTC_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** The instant (epoch ms) of a stored all-aboard: Bogotá wall-clock + 5 h = UTC. */
function allAboardToMs(a: AllAboard): number | null {
  const ymd = YMD_RE.exec(a.ymd);
  const min = hhmmToMin(a.hhmm);
  if (!ymd || min === null) return null;
  return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 0, min) + BOGOTA_UTC_OFFSET_MS;
}

function parseStored(raw: string | null): AllAboard | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const { ymd, hhmm } = v as Record<string, unknown>;
    if (typeof ymd === 'string' && typeof hhmm === 'string' && YMD_RE.test(ymd) && HHMM_RE.test(hhmm)) {
      return { ymd, hhmm };
    }
  } catch {
    // a corrupt value is the same as nothing stored
  }
  return null;
}

// Half-hour presets 13:00 – 20:00 (15 chips = 3 rows of 5).
const PRESET_ROWS: string[][] = (() => {
  const all: string[] = [];
  for (let m = 13 * 60; m <= 20 * 60; m += 30) all.push(minToHhmm(m));
  const rows: string[][] = [];
  for (let i = 0; i < all.length; i += PRESET_COLS) rows.push(all.slice(i, i + PRESET_COLS));
  return rows;
})();

/**
 * Fare rows are copied verbatim from the city module, so label / value_text / note arrive as
 * L4 objects {es,en,fr,pt} even though FareRow declares them as string. Accept both and never
 * hand an object to <Text>.
 */
function txt(v: unknown, lang: string): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return pickL4(v as L4, lang);
  return '';
}

/** "COP 12.250" — thousands dots, no Intl (same string on Hermes, browser and Node). */
function formatCop(n: number): string {
  return `COP ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

// ── Return-to-ship countdown ─────────────────────────────────────────────────
function AllAboardCard({ bufferMin }: { bufferMin: number }) {
  const tr = useTr();
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [stored, setStored] = useState<AllAboard | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const touched = useRef(false);

  // Clock: first value only after mount, then a 30 s tick and an immediate refresh when the
  // app / tab comes back to the foreground (timers are throttled while backgrounded).
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    setMounted(true);
    const id = setInterval(tick, TICK_MS);
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  // Restore today's all-aboard. A tap that lands before the read finishes wins (`touched`).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const parsed = parseStored(await AsyncStorage.getItem(STORAGE_KEY));
        if (!alive || touched.current) return;
        if (parsed && parsed.ymd === bogotaYmd(Date.now())) {
          setStored(parsed);
        } else if (parsed) {
          await AsyncStorage.removeItem(STORAGE_KEY); // a previous day's time is dead weight
        }
      } catch (e) {
        console.error('[PortDay] restore all-aboard', e);
      } finally {
        if (alive) setStorageReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const choose = useCallback((hhmm: string) => {
    const next: AllAboard = { ymd: bogotaYmd(Date.now()), hhmm };
    touched.current = true;
    setStored(next);
    setNowMs(Date.now());
    (async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('[PortDay] persist all-aboard', e);
      }
    })();
  }, []);

  // A stored time only counts for the Bogotá day it was set on; crossing midnight while the
  // screen is open drops back to the empty state without touching storage.
  const ready = mounted && storageReady && nowMs !== null;
  const todayYmd = nowMs !== null ? bogotaYmd(nowMs) : null;
  const active: AllAboard | null = stored && stored.ymd === todayYmd ? stored : null;
  const setMin = active ? hhmmToMin(active.hhmm) : null;
  const targetMs = active ? allAboardToMs(active) : null;
  const remainingMs = ready && targetMs !== null && nowMs !== null ? targetMs - nowMs : null;
  const warn = remainingMs !== null && remainingMs < bufferMin * 60000;
  const remMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
  const hrs = remMin !== null ? Math.floor(remMin / 60) : 0;
  const mins = remMin !== null ? remMin % 60 : 0;
  const leaveBy = setMin !== null ? minToHhmm((((setMin - bufferMin) % 1440) + 1440) % 1440) : null;

  const step = useCallback((delta: number) => {
    if (setMin === null) return;
    const next = Math.min(LAST_MIN_OF_DAY, Math.max(0, setMin + delta));
    if (next !== setMin) choose(minToHhmm(next));
  }, [setMin, choose]);

  const minLabel = tr('min');
  const downOff = setMin === null || setMin <= 0;
  const upOff = setMin === null || setMin >= LAST_MIN_OF_DAY;

  let readout: React.ReactNode;
  let readoutLabel = tr('Regreso al barco');
  if (remMin !== null) {
    readoutLabel = `${readoutLabel}: ${hrs > 0 ? `${hrs} h ` : ''}${mins} ${minLabel}`;
    readout = (
      <>
        <Text style={[s.hero, warn && s.heroWarn]} testID="port-day-remaining">
          {hrs > 0 ? (
            <>
              <Text>{hrs}</Text>
              <Text style={s.heroUnit}> h </Text>
            </>
          ) : null}
          <Text>{hrs > 0 ? pad2(mins) : mins}</Text>
          <Text style={s.heroUnit}> {minLabel}</Text>
        </Text>
        <View style={[s.leaveRow, warn && s.leaveRowWarn]} testID="port-day-leave-by">
          <Ionicons name="walk" size={16} color={warn ? AMBER : COLORS.icon} />
          <Text style={[s.leaveLabel, warn && s.leaveTextWarn]}>{tr('Sal del Centro a esta hora')}</Text>
          <Text style={[s.leaveTime, warn && s.leaveTextWarn]}>{leaveBy}</Text>
        </View>
      </>
    );
  } else if (ready) {
    readout = (
      <View style={s.emptyBox} testID="port-day-empty">
        <Text style={s.emptyTitle}>{tr('Define tu hora de zarpe')}</Text>
        <Text style={s.emptySub}>{tr('Te avisamos con margen de 90 min')}</Text>
      </View>
    );
  } else {
    readout = (
      <>
        <Text style={s.hero} testID="port-day-remaining">—</Text>
        <View style={s.leaveRow}>
          <Ionicons name="walk" size={16} color={COLORS.icon} />
          <Text style={s.leaveLabel}>{tr('Sal del Centro a esta hora')}</Text>
          <Text style={s.leaveTime}>—</Text>
        </View>
      </>
    );
  }

  return (
    <View style={[s.card, warn && s.cardWarn]} testID="port-day-countdown">
      <View style={s.cardHead}>
        <View style={[s.iconDisc, warn && s.iconDiscWarn]}>
          <Ionicons name={warn ? 'alert-circle' : 'boat'} size={20} color={warn ? AMBER : COLORS.primary} />
        </View>
        <Text style={s.cardTitle}>{tr('Regreso al barco')}</Text>
      </View>

      <View style={s.readout} accessibilityRole="timer" accessibilityLabel={readoutLabel}>
        {readout}
      </View>

      <Text style={s.selLabel}>{tr('Hora de zarpe (all aboard)')}</Text>
      <View accessibilityRole="radiogroup" style={s.chipGrid}>
        {PRESET_ROWS.map((row, ri) => (
          <View key={`row${ri}`} style={s.chipRow}>
            {row.map((hhmm) => {
              const on = active?.hhmm === hhmm;
              return (
                <TouchableOpacity
                  key={hhmm}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => choose(hhmm)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityLabel={hhmm}
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  testID={`port-day-chip-${hhmm.replace(':', '')}`}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{hhmm}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={s.stepper}>
        <TouchableOpacity
          style={[s.stepBtn, downOff && s.stepBtnOff]}
          onPress={() => step(-STEP_MIN)}
          disabled={downOff}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`−${STEP_MIN} ${minLabel}`}
          accessibilityState={{ disabled: downOff }}
          testID="port-day-step-down"
        >
          <Ionicons name="remove" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={s.stepCenter}>
          <Text style={s.stepTime} testID="port-day-allaboard">{active ? active.hhmm : '—'}</Text>
          <Text style={s.stepHint}>±{STEP_MIN} {minLabel}</Text>
        </View>
        <TouchableOpacity
          style={[s.stepBtn, upOff && s.stepBtnOff]}
          onPress={() => step(STEP_MIN)}
          disabled={upOff}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`+${STEP_MIN} ${minLabel}`}
          accessibilityState={{ disabled: upOff }}
          testID="port-day-step-up"
        >
          <Ionicons name="add" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Cruise-day banner (rendered ONLY when live data says ships >= 1) ─────────
function CrowdBanner({ note }: { note: L4 | null }) {
  const tr = useTr();
  const { lang } = useLang();
  const text = pickL4(note, lang);
  return (
    <View style={s.crowd} testID="port-day-crowd-banner">
      <View style={s.crowdIcon}>
        <Ionicons name="boat" size={18} color={COLORS.coral} />
      </View>
      <View style={s.crowdBody}>
        <Text style={s.crowdTitle}>{tr('Hoy hay crucero en puerto')}</Text>
        {!!text && <Text style={s.crowdText}>{text}</Text>}
      </View>
    </View>
  );
}

// ── "Ver en Moverse" row (internal navigation to the city hub module) ────────
function MoverseLink({
  href, icon, caption, testID,
}: { href: string; icon: IconName; caption?: string; testID: string }) {
  const tr = useTr();
  const go = useCallback(() => {
    try {
      router.push(href as NavHref);
    } catch (e) {
      console.error('[PortDay] navigate', href, e);
    }
  }, [href]);
  return (
    <TouchableOpacity
      style={s.linkBtn}
      onPress={go}
      activeOpacity={0.8}
      accessibilityRole="link"
      accessibilityLabel={caption ? `${tr('Ver en Moverse')} · ${caption}` : tr('Ver en Moverse')}
      testID={testID}
    >
      <View style={s.linkIcon}>
        <Ionicons name={icon} size={17} color={COLORS.official} />
      </View>
      <View style={s.linkBody}>
        {!!caption && <Text style={s.linkCaption}>{caption}</Text>}
        <Text style={s.linkLabel}>{tr('Ver en Moverse')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

// ── Official taxi fares ──────────────────────────────────────────────────────
function FareRowView({ fare, lang, first }: { fare: FareRow; lang: string; first: boolean }) {
  const tr = useTr();
  const label = txt(fare.label, lang);
  const cop = typeof fare.value_cop === 'number' && Number.isFinite(fare.value_cop) && fare.value_cop > 0
    ? fare.value_cop
    : null;
  const value = cop !== null ? formatCop(cop) : txt(fare.value_text, lang);
  const verify = fare.confidence === 'VERIFY';
  return (
    <View style={[s.fareRow, !first && s.fareDivider]} testID={`port-day-fare-${fare.key}`}>
      <Text style={s.fareLabel}>{label}</Text>
      <View style={s.fareValueRow}>
        {!!value && <Text style={cop !== null ? s.fareCop : s.fareText}>{value}</Text>}
        {verify && (
          <View style={s.verifyChip}>
            <Ionicons name="alert-circle-outline" size={11} color={COLORS.coral} />
            <Text style={s.verifyChipText}>{tr('sin verificar')}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function FareSection({ kit }: { kit: PortDayKit }) {
  const tr = useTr();
  const { lang } = useLang();
  const fares: FareRow[] = Array.isArray(kit.fares) ? kit.fares : [];
  const first: FareRow | undefined = fares[0];
  const link = typeof kit.fare_link === 'string' && kit.fare_link.startsWith('/') ? kit.fare_link : null;
  return (
    <View style={s.section} testID="port-day-fares">
      <View style={s.sectionHead}>
        <Ionicons name="car" size={16} color={COLORS.icon} />
        <Text style={s.sectionTitle}>{tr('Tarifas oficiales de taxi')}</Text>
      </View>
      {fares.length > 0 && (
        <View style={s.fareCard}>
          {fares.map((f, i) => (
            <FareRowView key={f.key || String(i)} fare={f} lang={lang} first={i === 0} />
          ))}
        </View>
      )}
      {first && (
        <View style={s.sourceBox} testID="port-day-fares-source">
          {!!first.source_name && (
            <View style={s.sourceRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.textFaint} style={s.sourceIcon} />
              <Text style={s.sourceText}>{first.source_name}</Text>
            </View>
          )}
          {!!first.last_verified && (
            <Text style={s.sourceVerified}>{tr('Última verificación')}: {first.last_verified}</Text>
          )}
        </View>
      )}
      {link && <MoverseLink href={link} icon="car" testID="port-day-link-fares" />}
    </View>
  );
}

// ── Itineraries ──────────────────────────────────────────────────────────────
type Tone = { fg: string; bg: string; border: string };
const NEUTRAL_TONE: Tone = { fg: COLORS.textMuted, bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.14)' };
const PAID_TONE: Tone = { fg: COLORS.mustard, bg: 'rgba(233,185,73,0.12)', border: 'rgba(233,185,73,0.35)' };
const TIER_TONE: Record<AccessTier, Tone> = {
  free: { fg: '#22C55E', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
  purchase: PAID_TONE,
  reservation: PAID_TONE,
  paid_entry: PAID_TONE,
  guest_only: { fg: COLORS.coral, bg: 'rgba(255,107,74,0.12)', border: 'rgba(255,107,74,0.35)' },
};

function StopRow({
  index, stop, doc, lang,
}: { index: number; stop: ItineraryStop; doc: LensesDoc; lang: string }) {
  const tr = useTr();
  const tier = accessLabel(doc, stop.access_tier, lang);
  const tone = TIER_TONE[stop.access_tier] ?? NEUTRAL_TONE;
  const first = index === 0;
  return (
    <View style={[s.stopRow, index > 0 && s.stopDivider]} testID={`port-day-stop-${stop.pin}`}>
      <View style={[s.stopNum, first && s.stopNumFirst]}>
        <Text style={[s.stopNumText, first && s.stopNumTextFirst]}>{index + 1}</Text>
      </View>
      <View style={s.stopMain}>
        <Text style={s.stopName}>{stop.name}</Text>
        {!!tier && (
          <View style={[s.tierChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={[s.tierChipText, { color: tone.fg }]}>{tier}</Text>
          </View>
        )}
      </View>
      <Text style={s.stopMin}>{stop.minutes} {tr('min')}</Text>
    </View>
  );
}

function ItineraryCard({ it, doc }: { it: Itinerary; doc: LensesDoc }) {
  const tr = useTr();
  const { lang } = useLang();
  const stops: ItineraryStop[] = Array.isArray(it.stops) ? it.stops : [];
  return (
    <View style={s.itCard} testID={`port-day-itinerary-${it.id}`}>
      <Text style={s.itTitle}>{pickL4(it.title, lang)}</Text>
      <View style={s.durationPill}>
        <Ionicons name="time-outline" size={12} color={COLORS.textMuted} />
        <Text style={s.durationText}>{it.duration_h} {tr('horas')}</Text>
      </View>
      <Text style={s.itNote}>{pickL4(it.note, lang)}</Text>
      <PortDaySchematic stops={stops} />
      <View style={s.stopList}>
        {stops.map((stop, i) => (
          <StopRow key={stop.pin || String(i)} index={i} stop={stop} doc={doc} lang={lang} />
        ))}
      </View>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function PortDayScreen() {
  const tr = useTr();
  const { lang } = useLang();
  // Bundled floor, synchronously: identical on the server render and the first client render.
  const [doc, setDoc] = useState<LensesDoc>(() => bundledLenses());

  useEffect(() => {
    let alive = true;
    const hydrate = () => {
      loadLenses()
        .then((d) => {
          if (alive) setDoc(d);
        })
        .catch((e) => console.error('[PortDay] hydrate', e));
    };
    hydrate();
    // Coming back to a screen that stayed open (overnight, a long lunch): re-check the cruise
    // count. loadLenses() is TTL-cached, so this is one cheap call, and a failed/expired read
    // yields crowd_today = null — the badge hides rather than showing yesterday's ships.
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') hydrate();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const goBack = useCallback(() => goBackOr(router), []);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const kit: PortDayKit | null = doc.port_day;
  const bufferMin = kit && Number.isFinite(kit.return_buffer_min) && kit.return_buffer_min > 0
    ? kit.return_buffer_min
    : DEFAULT_BUFFER_MIN;
  const ships = kit?.crowd_today?.ships;
  const cruiseToday = typeof ships === 'number' && ships >= 1;
  const itineraries: Itinerary[] = kit && Array.isArray(kit.itineraries)
    ? kit.itineraries.filter((it) => Array.isArray(it.stops) && it.stops.length > 0)
    : [];
  const muelle = kit && typeof kit.muelle_link === 'string' && kit.muelle_link.startsWith('/') ? kit.muelle_link : null;
  const tagline = pickL4(lensDef(doc, 'port_day')?.tagline, lang);

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="port-day-screen">
      <Head><title>{`${tr('Día de crucero')} · AMO Life`}</title></Head>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.content}>
          <View style={s.header}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel={tr('Volver')}
              testID="port-day-back-btn"
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={s.headerText}>
              <Text style={s.title}>{tr('Día de crucero')}</Text>
              <View style={s.offlineChip} testID="port-day-offline-chip">
                <Ionicons name="cloud-offline-outline" size={12} color={COLORS.primary} />
                <Text style={s.offlineChipText}>{tr('Funciona sin conexión')}</Text>
              </View>
            </View>
          </View>

          {kit ? (
            <>
              <AllAboardCard bufferMin={bufferMin} />

              {cruiseToday ? <CrowdBanner note={kit.crowd_note} /> : null}

              <FareSection kit={kit} />

              {itineraries.length > 0 && (
                <View style={s.section} testID="port-day-itineraries">
                  <View style={s.sectionHead}>
                    <Ionicons name="map-outline" size={16} color={COLORS.icon} />
                    <Text style={s.sectionTitle}>{tr('Itinerarios para tu escala')}</Text>
                  </View>
                  {itineraries.map((it) => (
                    <ItineraryCard key={it.id} it={it} doc={doc} />
                  ))}
                </View>
              )}

              {muelle && (
                <View style={s.footer}>
                  <MoverseLink href={muelle} icon="boat" caption={tr('Muelle e islas')} testID="port-day-link-muelle" />
                </View>
              )}
            </>
          ) : (
            <View style={s.soonCard} testID="port-day-soon">
              <Ionicons name="construct-outline" size={28} color={COLORS.textMuted} />
              <Text style={s.soonTitle}>{tr('En construcción')}</Text>
              {!!tagline && <Text style={s.soonText}>{tagline}</Text>}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 6, alignItems: 'flex-start' },
  title: { ...TYPE.title1, color: COLORS.textMain },
  offlineChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(18,181,165,0.12)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.4)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  offlineChipText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.3 },

  // countdown card
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  cardWarn: { borderColor: 'rgba(245,158,11,0.45)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4 },
  iconDisc: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.15)', alignItems: 'center', justifyContent: 'center' },
  iconDiscWarn: { backgroundColor: 'rgba(245,158,11,0.15)' },
  cardTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  readout: { minHeight: 96, justifyContent: 'center', gap: 10, marginTop: SPACING.md },
  hero: { fontSize: 38, lineHeight: 44, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  heroWarn: { color: AMBER },
  heroUnit: { fontSize: 16, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0 },
  leaveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  leaveRowWarn: { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.25)' },
  leaveLabel: { flex: 1, fontSize: 13, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
  leaveTime: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  leaveTextWarn: { color: AMBER },
  emptyBox: { gap: 4 },
  emptyTitle: { ...TYPE.title3, color: COLORS.textMain },
  emptySub: { ...TYPE.subhead, color: COLORS.textMuted },

  // all-aboard picker
  selLabel: { marginTop: SPACING.md, marginBottom: SPACING.sm, fontSize: 11, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  chipGrid: { gap: 8 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.04)' },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.semibold, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: COLORS.black, ...FONTS.bold },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.md },
  stepBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary, backgroundColor: 'rgba(18,181,165,0.10)' },
  stepBtnOff: { opacity: 0.35 },
  stepCenter: { alignItems: 'center', gap: 2 },
  stepTime: { fontSize: 26, lineHeight: 30, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  stepHint: { fontSize: 11, color: COLORS.textFaint, ...FONTS.medium },

  // cruise-day banner
  crowd: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: 'rgba(255,107,74,0.10)', borderWidth: 1, borderColor: 'rgba(255,107,74,0.35)' },
  crowdIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,107,74,0.16)', alignItems: 'center', justifyContent: 'center' },
  crowdBody: { flex: 1, gap: 3 },
  crowdTitle: { fontSize: 14, lineHeight: 19, color: COLORS.textMain, ...FONTS.bold },
  crowdText: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },

  // sections
  section: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain, flex: 1 },

  // fares
  fareCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, paddingHorizontal: SPACING.md },
  fareRow: { paddingVertical: 12, gap: 4 },
  fareDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  fareLabel: { fontSize: 13, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  fareValueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  fareCop: { fontSize: 16, lineHeight: 20, color: COLORS.primary, ...FONTS.bold, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  fareText: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },
  verifyChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  verifyChipText: { fontSize: 9.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  sourceBox: { marginTop: SPACING.sm + 4, marginBottom: SPACING.sm, gap: 3, paddingHorizontal: 2 },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  sourceIcon: { marginTop: 1 },
  sourceText: { flex: 1, fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },
  sourceVerified: { fontSize: 10.5, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium, paddingLeft: 18 },

  // link rows
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingHorizontal: SPACING.md, paddingVertical: 10, marginTop: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(57,184,255,0.22)' },
  linkIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(57,184,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  linkBody: { flex: 1, gap: 1 },
  linkCaption: { fontSize: 11, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium },
  linkLabel: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },

  // itineraries
  itCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  itTitle: { ...TYPE.headline, color: COLORS.textMain },
  durationPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3 },
  durationText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },
  itNote: { marginTop: 8, fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },
  stopList: { marginTop: SPACING.md },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8 },
  stopDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  stopNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceAlt, borderWidth: 1.5, borderColor: COLORS.primary },
  stopNumFirst: { backgroundColor: COLORS.mustard, borderColor: COLORS.mustard },
  stopNumText: { fontSize: 12, color: COLORS.textMain, ...FONTS.bold },
  stopNumTextFirst: { color: '#1A1206' },
  stopMain: { flex: 1, gap: 4, alignItems: 'flex-start' },
  stopName: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  tierChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  tierChipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  stopMin: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, fontVariant: ['tabular-nums'] },

  footer: { marginTop: SPACING.sm },

  // gated / missing kit
  soonCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  soonTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  soonText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
});
