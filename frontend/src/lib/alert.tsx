import React, { useEffect, useState, useCallback } from 'react';
import { Platform, Alert as RNAlert, Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';

// Web-safe Alert. react-native-web does NOT implement Alert.alert — it renders
// NOTHING — so every `Alert.alert(...)` on the web build was a silent no-op
// (the "no error, no login" class of bug). This drop-in replacement keeps the
// exact react-native signature — Alert.alert(title, message?, buttons?, options?) —
// including confirm/cancel/destructive buttons with onPress, and renders a themed
// modal on web. On native it delegates to the real RN Alert.

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertReq = { id: number; title?: string; message?: string; buttons?: AlertButton[] };

let _emit: ((req: AlertReq) => void) | null = null;
const _pending: AlertReq[] = []; // requests fired before <AlertHost/> mounts are buffered, never dropped
let _seq = 1;

function dispatch(req: AlertReq) {
  if (_emit) _emit(req);
  else _pending.push(req);
}

export const Alert = {
  alert(title?: string, message?: string, buttons?: AlertButton[], options?: any) {
    if (Platform.OS !== 'web') {
      RNAlert.alert(title as any, message, buttons as any, options);
      return;
    }
    dispatch({ id: _seq++, title, message, buttons });
  },
};

// Mount ONCE near the app root (inside providers, above the navigator overlay).
export function AlertHost() {
  const [queue, setQueue] = useState<AlertReq[]>([]);

  useEffect(() => {
    _emit = (req) => setQueue((q) => [...q, req]);
    if (_pending.length) {
      setQueue((q) => [...q, ..._pending.splice(0, _pending.length)]);
    }
    return () => { _emit = null; };
  }, []);

  const current = queue[0];
  const close = useCallback((onPress?: () => void) => {
    setQueue((q) => q.slice(1));
    onPress?.();
  }, []);

  if (Platform.OS !== 'web' || !current) return null;
  const buttons: AlertButton[] = current.buttons && current.buttons.length ? current.buttons : [{ text: 'OK' }];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => close()}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          {current.title ? <Text style={styles.title}>{current.title}</Text> : null}
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={[styles.row, buttons.length > 2 && styles.rowStacked]}>
            {buttons.map((b, i) => {
              const destructive = b.style === 'destructive';
              const cancel = b.style === 'cancel';
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.btn, destructive && styles.btnDestructive, cancel && styles.btnCancel, buttons.length > 2 && styles.btnFull]}
                  onPress={() => close(b.onPress)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.btnText, destructive && styles.btnTextDestructive, cancel && styles.btnTextCancel]}>
                    {b.text || 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  card: { width: '100%', maxWidth: 380, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg, gap: SPACING.sm },
  title: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold },
  message: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm, marginTop: SPACING.sm },
  rowStacked: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  btn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: RADIUS.full, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  btnFull: { width: '100%' },
  btnCancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  btnDestructive: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
  btnText: { fontSize: 14, color: COLORS.white, ...FONTS.bold },
  btnTextDestructive: { color: '#FCA5A5' },
  btnTextCancel: { color: COLORS.textMuted },
});
