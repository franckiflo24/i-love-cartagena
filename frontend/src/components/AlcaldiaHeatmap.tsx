import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView,
  TouchableOpacity, Platform, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';

const { width: SCREEN_W } = Dimensions.get('window');

type HeatmapPoint = { lat: number; lng: number; weight: number; intensity: number };
type HeatmapZone = {
  zone: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
  lat?: number;
  lng?: number;
};
type HeatmapData = {
  period_days: number;
  generated_at: string;
  kpis: {
    total_pings: number;
    unique_users: number;
    active_zones: number;
    busiest_hour: number | null;
    busiest_hour_count: number;
  };
  points: HeatmapPoint[];
  zones: HeatmapZone[];
  peak_hours: { hour: number; count: number }[];
  city_center: { lat: number; lng: number; zoom: number };
};

const PERIODS = [
  { key: 7, label: '7 días' },
  { key: 30, label: '30 días' },
  { key: 90, label: '90 días' },
];

const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

function buildHeatmapHTML(data: HeatmapData): string {
  const center = data.city_center;
  const pointsJson = JSON.stringify(
    data.points.map((p) => [p.lat, p.lng, p.intensity])
  );
  const zonesJson = JSON.stringify(
    data.zones
      .filter((z) => z.lat != null && z.lng != null)
      .map((z) => ({
        lat: z.lat,
        lng: z.lng,
        label: z.label,
        count: z.count,
        pct: z.percentage,
        color: z.color,
      }))
  );

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width: 100%; height: 100%; background:#050814; overflow: hidden; }
  #map { width:100vw; height:100vh; }
  .leaflet-popup-content-wrapper { border-radius:12px; background:#0F1423; color:#fff; }
  .leaflet-popup-content { color:#fff; margin: 10px 14px; font-family: -apple-system, sans-serif; }
  .leaflet-popup-tip { background:#0F1423 !important; }
  .leaflet-control-zoom a { background:#1a1a2e !important; color:#D97706 !important; border:1px solid #2a2a4e !important; }
  .leaflet-control-attribution { display:none; }
  .zone-marker { background:transparent; border:none; }
  .zone-pill {
    display:inline-flex; align-items:center; gap:6px;
    padding: 4px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
    color: #fff;
    border: 2px solid rgba(255,255,255,0.95);
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    white-space: nowrap;
  }
  .zone-dot { width:8px; height:8px; border-radius:50%; background: rgba(255,255,255,0.9); }
</style>
</head><body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
    .setView([${center.lat}, ${center.lng}], ${center.zoom});

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

  var pts = ${pointsJson};
  if (pts.length > 0) {
    L.heatLayer(pts, {
      radius: 28,
      blur: 22,
      maxZoom: 17,
      max: 1.0,
      minOpacity: 0.45,
      gradient: { 0.2: '#3B82F6', 0.4: '#22D3EE', 0.6: '#FACC15', 0.8: '#F97316', 1.0: '#EF4444' }
    }).addTo(map);
  }

  // Zone label markers
  var zones = ${zonesJson};
  zones.forEach(function(z) {
    var icon = L.divIcon({
      className: 'zone-marker',
      html: '<div class="zone-pill" style="background:' + z.color + '"><span class="zone-dot"></span>' + z.label + ' · ' + z.count + '</div>',
      iconSize: null,
      iconAnchor: [50, 14]
    });
    L.marker([z.lat, z.lng], { icon: icon, zIndexOffset: 100 })
      .addTo(map)
      .bindPopup('<b>' + z.label + '</b><br/>' + z.count + ' visitas · ' + z.pct + '%');
  });
</script>
</body></html>`;
}

export default function AlcaldiaHeatmap({ token }: { token: string }) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<number>(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/business/admin/heatmap?days=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error('Heatmap load error', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, token]);

  const html = useMemo(() => (data ? buildHeatmapHTML(data) : ''), [data]);

  if (loading || !data) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Cargando datos del mapa…</Text>
      </View>
    );
  }

  const k = data.kpis;
  const maxHour = data.peak_hours.reduce((m, h) => Math.max(m, h.count), 0);

  return (
    <View style={styles.section}>
      {/* Period filter */}
      <View style={styles.periodRow}>
        <Text style={styles.periodLabel}>Período</Text>
        <View style={styles.periodPills}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodPill, period === p.key && styles.periodPillActive]}
              onPress={() => setPeriod(p.key)}
            >
              <Text style={[styles.periodPillText, period === p.key && styles.periodPillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* KPI cards */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: '#EF4444' }]}>
          <Ionicons name="location" size={16} color="#EF4444" />
          <Text style={styles.kpiValue}>{fmtNum(k.total_pings)}</Text>
          <Text style={styles.kpiLabel}>Visitas registradas</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: '#3B82F6' }]}>
          <Ionicons name="people" size={16} color="#3B82F6" />
          <Text style={styles.kpiValue}>{fmtNum(k.unique_users)}</Text>
          <Text style={styles.kpiLabel}>Turistas únicos</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: '#F59E0B' }]}>
          <Ionicons name="navigate" size={16} color="#F59E0B" />
          <Text style={styles.kpiValue}>{fmtNum(k.active_zones)}</Text>
          <Text style={styles.kpiLabel}>Zonas activas</Text>
        </View>
      </View>

      {k.busiest_hour != null && (
        <View style={styles.busiestBox}>
          <Ionicons name="time" size={14} color="#FACC15" />
          <Text style={styles.busiestText}>
            Hora de mayor actividad:{' '}
            <Text style={styles.busiestHour}>{String(k.busiest_hour).padStart(2, '0')}:00h</Text>
            {' · '}
            {fmtNum(k.busiest_hour_count)} visitas
          </Text>
        </View>
      )}

      {/* Heatmap */}
      <Text style={styles.sectionTitle}>Mapa de calor — turistas en Cartagena</Text>
      <Text style={styles.sectionSubtitle}>
        Cada punto representa actividad real de los usuarios. Más rojo = más concentración.
      </Text>
      <View style={styles.mapWrap}>
        {Platform.OS === 'web' ? (
          // @ts-ignore — iframe is web-only
          <iframe
            srcDoc={html}
            style={{
              width: '100%',
              height: 380,
              border: 'none',
              borderRadius: 16,
              background: '#050814',
            }}
            sandbox="allow-scripts"
          />
        ) : (
          <WebView
            source={{ html }}
            style={styles.webview}
            originWhitelist={['*']}
            scalesPageToFit
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
          />
        )}
        {/* Legend overlay */}
        <View style={styles.legendBar}>
          <Text style={styles.legendText}>Menos</Text>
          <View style={styles.gradient}>
            {['#3B82F6', '#22D3EE', '#FACC15', '#F97316', '#EF4444'].map((c) => (
              <View key={c} style={[styles.gradientStop, { backgroundColor: c }]} />
            ))}
          </View>
          <Text style={styles.legendText}>Más</Text>
        </View>
      </View>

      {/* Zone ranking bars */}
      <Text style={styles.sectionTitle}>Ranking por zona</Text>
      <Text style={styles.sectionSubtitle}>
        Distribución de visitas por barrio · top {data.zones.length} zonas
      </Text>
      <View style={styles.zonesList}>
        {data.zones.map((z, idx) => {
          const pct = z.percentage;
          const barW = Math.max(4, pct);
          return (
            <View key={z.zone} style={styles.zoneRow}>
              <View style={styles.zoneRowTop}>
                <View style={styles.zoneRowLeft}>
                  <View style={[styles.zoneRank, { backgroundColor: z.color }]}>
                    <Text style={styles.zoneRankText}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.zoneLabel}>{z.label}</Text>
                    <Text style={styles.zoneCount}>
                      {fmtNum(z.count)} visitas
                    </Text>
                  </View>
                </View>
                <Text style={[styles.zonePct, { color: z.color }]}>{pct}%</Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${barW}%`, backgroundColor: z.color },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Hourly distribution */}
      <Text style={styles.sectionTitle}>Distribución por hora</Text>
      <Text style={styles.sectionSubtitle}>
        ¿A qué horas los turistas están más activos en la ciudad?
      </Text>
      <View style={styles.hoursWrap}>
        {data.peak_hours.map((h) => {
          const heightPct = maxHour ? (h.count / maxHour) * 100 : 0;
          const isPeak = h.hour === k.busiest_hour;
          return (
            <View key={h.hour} style={styles.hourCol}>
              <View style={styles.hourBarBg}>
                <View
                  style={[
                    styles.hourBarFill,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: isPeak ? '#FACC15' : COLORS.primary,
                    },
                  ]}
                />
              </View>
              {h.hour % 4 === 0 && (
                <Text style={styles.hourLabel}>
                  {String(h.hour).padStart(2, '0')}h
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {/* IA note */}
      <View style={styles.iaNote}>
        <Ionicons name="bulb" size={14} color={COLORS.primary} />
        <Text style={styles.iaNoteText}>
          Datos agregados y anónimos. Recolectados cuando los usuarios usan el mapa de la app con permisos otorgados. Útil para planeación urbana, dispersión de turismo y seguridad.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xl },

  loadingBox: { padding: SPACING.xl, alignItems: 'center' },
  loadingText: { color: COLORS.textMuted, marginTop: SPACING.sm, fontSize: 12, ...FONTS.medium },

  periodRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  periodLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginRight: SPACING.sm },
  periodPills: { flexDirection: 'row', gap: 6, flex: 1 },
  periodPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.03)' },
  periodPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  periodPillText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },
  periodPillTextActive: { color: COLORS.white },

  kpiRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  kpiCard: { flex: 1, padding: SPACING.sm, borderRadius: RADIUS.lg, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'flex-start', gap: 4 },
  kpiValue: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  kpiLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  busiestBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(250,204,21,0.10)', borderColor: '#FACC15', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  busiestText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },
  busiestHour: { color: '#FACC15', ...FONTS.bold },

  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.md, marginBottom: 2, letterSpacing: 0.3 },
  sectionSubtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.sm },

  mapWrap: { position: 'relative', borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md, height: 380, backgroundColor: '#050814' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  legendBar: { position: 'absolute', bottom: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 },
  legendText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },
  gradient: { flex: 1, flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
  gradientStop: { flex: 1, height: '100%' },

  zonesList: { marginBottom: SPACING.md },
  zoneRow: { marginBottom: SPACING.sm },
  zoneRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  zoneRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  zoneRank: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  zoneRankText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  zoneLabel: { fontSize: 12, color: COLORS.textMain, ...FONTS.semibold },
  zoneCount: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  zonePct: { fontSize: 13, ...FONTS.bold },
  barTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },

  hoursWrap: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2, paddingHorizontal: 4, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xs, marginBottom: SPACING.md },
  hourCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  hourBarBg: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  hourBarFill: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 1 },
  hourLabel: { fontSize: 8, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },

  iaNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(217,119,6,0.08)', borderColor: 'rgba(217,119,6,0.3)', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: RADIUS.md },
  iaNoteText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, flex: 1, lineHeight: 14 },
});
