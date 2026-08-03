// Live real-time distance to a venue ("🚶 a 320m de ti").
//
// Subscribes to the shared geoService and keeps the watch alive while
// mounted (visibility handling and the 5s/10m throttle come from the
// service). Fail-soft: no permission / no position / no coords → renders
// nothing, zero footprint.

import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';
import { geoService, GeoState, haversineM } from '../lib/geo';

export function LiveDistance({ lat, lng }: { lat?: number | null; lng?: number | null }) {
  const [geo, setGeo] = useState<GeoState>(geoService.getState());

  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState()));
    geoService.start();
    return () => {
      unsub();
      geoService.stop();
    };
  }, []);

  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const pos = geo.status === 'granted' ? geo.position : null;
  if (!pos) return null;
  const d = haversineM(pos.lat, pos.lng, lat, lng);
  if (!Number.isFinite(d) || d > 50000) return null;
  const label = d < 1000 ? `a ${Math.round(d / 10) * 10}m de ti` : `a ${(d / 1000).toFixed(1)}km de ti`;
  return <Text style={styles.dist}>🚶 {label}</Text>;
}

const styles = StyleSheet.create({
  dist: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, marginTop: 2 },
});

export default LiveDistance;
