// "Mi Base" sheet — set your hotel/Airbnb once, get back from anywhere with
// one tap. Directions, an Uber pre-filled to your door, or the address to
// show a taxi driver. Device-only storage (see lib/homeBase).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { geoService } from '../lib/geo';
import { nearestNeighborhood, NBH_LABELS, NbhCentroid } from '../utils/neighborhood';
import {
  getHomeBase, setHomeBase, clearHomeBase, syncHomeBase, directionsUrl, uberUrl, shareText, HomeBase,
} from '../lib/homeBase';

export function HomeBaseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tr = useTr();
  const [base, setBase] = useState<HomeBase | null>(null);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [neighborhoods, setNeighborhoods] = useState<NbhCentroid[]>([]);

  useEffect(() => {
    if (!visible) return;
    const b = getHomeBase();
    setBase(b);
    setEditing(!b);
    setLabel(b?.label || '');
    fetch('/data/neighborhoods.json').then(r => (r.ok ? r.json() : [])).then(setNeighborhoods).catch(() => {});
    // Pull the base saved to the account so it shows on ANY device the user signs into.
    syncHomeBase().then(sb => {
      if (sb) { setBase(sb); setEditing(false); setLabel(sb.label); }
    }).catch(() => {});
  }, [visible]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3500); };

  // Save the user's CURRENT location as their base. Auto-labels by barrio
  // (no geocoding API, no data leaves the device).
  const saveHere = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      let pos = geoService.getState().position;
      if (!pos || Date.now() - pos.ts > 20000) {
        await geoService.request();
        pos = geoService.getState().position;
      }
      if (!pos) { flash(tr('Activa tu ubicación para guardar tu base')); return; }
      const slug = nearestNeighborhood(pos.lat, pos.lng, neighborhoods);
      const auto = slug ? `${tr('Mi base')} · ${NBH_LABELS[slug] || slug}` : tr('Mi base');
      const b: HomeBase = { lat: pos.lat, lng: pos.lng, label: (label.trim() || auto), savedAt: Date.now() };
      setHomeBase(b);
      setBase(b);
      setLabel(b.label);
      setEditing(false);
      flash(tr('¡Base guardada! Ya puedes volver con un toque.'));
    } finally {
      setBusy(false);
    }
  }, [busy, label, neighborhoods, tr]);

  const saveLabel = useCallback(() => {
    if (!base) return;
    const b = { ...base, label: label.trim() || base.label };
    setHomeBase(b);
    setBase(b);
    setEditing(false);
  }, [base, label]);

  const open = (url: string) => Linking.openURL(url).catch(() => flash(tr('No se pudo abrir la app')));

  const copyAddress = useCallback(async () => {
    if (!base) return;
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.clipboard) { await nav.clipboard.writeText(shareText(base)); flash(tr('Ubicación copiada — muéstrasela al taxista')); return; }
    } catch {}
    flash(shareText(base));
  }, [base, tr]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Ionicons name="home" size={20} color={COLORS.primary} />
            <Text style={styles.title}>{tr('Mi Base')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {!!notice && <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>}

          {(!base || editing) ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.sub}>
                {tr('Guarda tu hotel o Airbnb una vez. Después, desde donde sea, vuelve con un toque — sin recordar direcciones.')}
              </Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={tr('Nombre (ej. Hotel Caribe, Airbnb Getsemaní)')}
                placeholderTextColor={COLORS.textMuted}
                style={styles.input}
                maxLength={40}
              />
              <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={saveHere} disabled={busy} activeOpacity={0.85}>
                <Ionicons name="location" size={18} color="#000" />
                <Text style={styles.primaryBtnText}>{busy ? tr('Guardando…') : tr('Guardar donde estoy ahora')}</Text>
              </TouchableOpacity>
              {!!base && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => { setEditing(false); setLabel(base.label); }}>
                  <Text style={styles.linkBtnText}>{tr('Cancelar')}</Text>
                </TouchableOpacity>
              )}
              {!!base && label.trim() && label.trim() !== base.label && (
                <TouchableOpacity style={styles.linkBtn} onPress={saveLabel}>
                  <Text style={styles.linkBtnText}>{tr('Guardar solo el nombre')}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.privacy}>{tr('Se guarda en tu cuenta para que puedas volver desde cualquier dispositivo.')}</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={styles.baseCard}>
                <Ionicons name="bed" size={18} color={COLORS.primary} />
                <Text style={styles.baseLabel} numberOfLines={2}>{base.label}</Text>
              </View>
              <Text style={styles.sub}>{tr('¿Cómo quieres volver?')}</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => open(directionsUrl(base))} activeOpacity={0.85}>
                <Ionicons name="navigate" size={18} color="#000" />
                <Text style={styles.primaryBtnText}>{tr('Cómo llegar')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.darkBtn} onPress={() => open(uberUrl(base))} activeOpacity={0.85}>
                <Ionicons name="car" size={18} color="#FFF" />
                <Text style={styles.darkBtnText}>{tr('Pedir Uber a mi base')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={copyAddress} activeOpacity={0.85}>
                <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                <Text style={styles.outlineBtnText}>{tr('Copiar ubicación para el taxi')}</Text>
              </TouchableOpacity>
              <View style={styles.editRow}>
                <TouchableOpacity onPress={() => { setEditing(true); setLabel(base.label); }} hitSlop={{ top: 8, bottom: 8 }}>
                  <Text style={styles.editLink}>{tr('Cambiar mi base')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { clearHomeBase(); setBase(null); setEditing(true); setLabel(''); }} hitSlop={{ top: 8, bottom: 8 }}>
                  <Text style={[styles.editLink, { color: '#F87171' }]}>{tr('Borrar')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, paddingBottom: Platform.OS === 'ios' ? 36 : SPACING.lg, gap: 12, borderTopWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  sub: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 18 },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: RADIUS.md, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, color: COLORS.textMain, fontSize: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  primaryBtnText: { fontSize: 15, color: '#000', ...FONTS.bold },
  darkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#000', borderRadius: RADIUS.full, paddingVertical: 14, borderWidth: 1, borderColor: COLORS.border },
  darkBtnText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.primary },
  outlineBtnText: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  linkBtn: { alignItems: 'center', paddingVertical: 6 },
  linkBtnText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  baseCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(212,175,55,0.10)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)', padding: 14 },
  baseLabel: { flex: 1, fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  editRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  editLink: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  notice: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)', padding: 10 },
  noticeText: { fontSize: 12.5, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center' },
  privacy: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', opacity: 0.75 },
});

export default HomeBaseSheet;
