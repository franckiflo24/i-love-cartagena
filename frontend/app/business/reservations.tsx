/**
 * Partner Reservations Management Screen
 *
 * Allows the partner to:
 *  • See incoming reservation REQUESTS (pending_confirmation) → confirm / reject
 *  • See confirmed upcoming reservations → mark completed / no-show / contact client
 *  • See historical reservations
 *  • Contact the client directly via WhatsApp (one-tap)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { useTr } from '../../src/i18n/autoTr';

type Reservation = {
  reservation_id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_phone?: string;
  user_whatsapp?: string;
  partner_id: string;
  partner_name: string;
  event?: { event_id?: string; title?: string } | null;
  type: string;
  date: string;
  time?: string | null;
  party_size: number;
  notes?: string;
  status: string;
  partner_note?: string;
  partner_rejection_reason?: string;
  confirmed_at?: string | null;
  created_at: string;
};

type Stats = {
  pending_count: number;
  confirmed_upcoming_count: number;
  completed_last_30d: number;
  locked_leads_count?: number;
  estimated_locked_value_cop?: number;
};

type FilterTab = 'pending' | 'upcoming' | 'history';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_confirmation: { label: 'Pendiente', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  pending_partner_activation: { label: '🔒 Lead bloqueado', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  confirmed: { label: 'Confirmada', color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  rejected_by_partner: { label: 'Rechazada', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  cancelled_by_user: { label: 'Cancelada (cliente)', color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  cancelled_late: { label: 'Cancelada tarde', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  completed: { label: 'Completada', color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  no_show: { label: 'No-show', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  expired: { label: 'Expirada', color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return iso;
  }
}

function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Math.round((Date.now() - d.getTime()) / 60000); // minutes ago
    if (diff < 1) return 'ahora';
    if (diff < 60) return `hace ${diff}m`;
    const h = Math.round(diff / 60);
    if (h < 24) return `hace ${h}h`;
    const days = Math.round(h / 24);
    return `hace ${days}d`;
  } catch {
    return '';
  }
}

export default function BusinessReservations() {
  const tr = useTr();
  const router = useRouter();
  const { token, authLoading } = useBusinessAuth() as any;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [membershipPlan, setMembershipPlan] = useState<'free' | 'pro'>('free');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<FilterTab>('pending');

  // Confirm/Reject modal state
  const [modalRes, setModalRes] = useState<Reservation | null>(null);
  const [modalAction, setModalAction] = useState<'confirm' | 'reject' | null>(null);
  const [modalNote, setModalNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Plan picker modal state (shown when a FREE partner taps a locked CTA)
  const [planPickerOpen, setPlanPickerOpen] = useState(false);

  const isPro = membershipPlan === 'pro';

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.get('/business/reservations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReservations(res.reservations || []);
      setStats(res.stats || null);
      setMembershipPlan((res.membership_plan as 'free' | 'pro') || 'free');
    } catch (e: any) {
      console.error('Load reservations:', e);
      Alert.alert(tr('Error'), String(e?.message || 'No se pudieron cargar las reservas'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, tr]);

  useEffect(() => {
    if (!token) {
      router.replace('/business/login');
      return;
    }
    load();
  }, [token, load, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openModal = (r: Reservation, action: 'confirm' | 'reject') => {
    setModalRes(r);
    setModalAction(action);
    setModalNote('');
  };

  const closeModal = () => {
    setModalRes(null);
    setModalAction(null);
    setModalNote('');
  };

  const submitAction = async () => {
    if (!modalRes || !modalAction) return;
    setActionLoading(true);
    try {
      await api.patch(
        `/business/reservations/${modalRes.reservation_id}`,
        { action: modalAction, note: modalNote.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      // Optimistically update local state so the UI reflects the action
      const newStatus = modalAction === 'confirm' ? 'confirmed' : 'rejected_by_partner';
      setReservations(prev =>
        prev.map(r => r.reservation_id === modalRes.reservation_id
          ? { ...r, status: newStatus, partner_note: modalNote.trim() || r.partner_note }
          : r),
      );
      closeModal();
      Alert.alert(
        tr('Listo'),
        modalAction === 'confirm'
          ? tr('Reserva confirmada. El cliente ya puede ver tu link de pago.')
          : tr('Reserva rechazada. El cliente fue notificado.'),
      );
    } catch (e: any) {
      Alert.alert(tr('Error'), String(e?.message || 'No se pudo actualizar'));
    } finally {
      setActionLoading(false);
    }
  };

  const quickAction = (r: Reservation, action: 'complete' | 'no_show') => {
    const label = action === 'complete' ? tr('marcar como completada') : tr('marcar como no-show');
    Alert.alert(
      tr('Confirmar acción'),
      tr(`¿${label}?`),
      [
        { text: tr('Cancelar'), style: 'cancel' },
        {
          text: 'OK',
          onPress: async () => {
            try {
              await api.patch(
                `/business/reservations/${r.reservation_id}`,
                { action },
                { headers: { Authorization: `Bearer ${token}` } },
              );
              // Optimistically update local state
              setReservations(prev =>
                prev.map(res => res.reservation_id === r.reservation_id
                  ? { ...res, status: action === 'complete' ? 'completed' : 'no_show' }
                  : res),
              );
            } catch (e: any) {
              Alert.alert(tr('Error'), String(e?.message || ''));
            }
          },
        },
      ],
    );
  };

  const openWhatsApp = (r: Reservation) => {
    const phone = (r.user_whatsapp || r.user_phone || '').replace(/[^\d+]/g, '');
    if (!phone) {
      Alert.alert(tr('Sin contacto'), tr('Este cliente no tiene WhatsApp / teléfono registrado.'));
      return;
    }
    const greeting = encodeURIComponent(
      `Hola ${r.user_name || ''}, te escribo de ${r.partner_name} respecto a tu reserva del ${r.date}${r.time ? ' a las ' + r.time : ''} para ${r.party_size} personas. ¿En qué puedo ayudarte?`,
    );
    Linking.openURL(`https://wa.me/${phone}?text=${greeting}`).catch(() => {});
  };

  if (authLoading || loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  // Filter by tab
  const filtered = reservations.filter((r) => {
    if (tab === 'pending') {
      return ['pending_confirmation', 'pending_partner_activation'].includes(r.status);
    }
    if (tab === 'upcoming') {
      if (r.status !== 'confirmed') return false;
      try {
        const dt = new Date(`${r.date}T${r.time || '12:00'}:00-05:00`);
        return dt.getTime() >= Date.now() - 3600000; // future or last hour
      } catch {
        return true;
      }
    }
    // history
    return ['completed', 'no_show', 'rejected_by_partner', 'cancelled_by_user', 'cancelled_late', 'expired'].includes(r.status);
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Reservas')}</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.headerBtn}>
          <Ionicons name="refresh" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Stats Banner */}
      {stats ? (
        <View style={styles.statsBanner}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.pending_count}</Text>
            <Text style={styles.statLabel}>{tr('Por confirmar')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#22C55E' }]}>{stats.confirmed_upcoming_count}</Text>
            <Text style={styles.statLabel}>{tr('Próximas')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: COLORS.textMain }]}>{stats.completed_last_30d}</Text>
            <Text style={styles.statLabel}>{tr('Completadas 30d')}</Text>
          </View>
        </View>
      ) : null}

      {/* FREE PARTNER: Upgrade banner */}
      {!isPro && stats && (stats.locked_leads_count || 0) > 0 ? (
        <View style={styles.upgradeBanner}>
          <View style={styles.upgradeHeader}>
            <Ionicons name="trending-up" size={20} color="#22C55E" />
            <Text style={styles.upgradeTitle}>
              {tr(`Tienes ${stats.locked_leads_count} solicitud(es) esperándote`)}
            </Text>
          </View>
          <Text style={styles.upgradeValue}>
            {tr('Valor estimado:')}{' '}
            <Text style={{ color: '#22C55E', ...FONTS.bold }}>
              ${Math.round((stats.estimated_locked_value_cop || 0) / 1000)}.000 COP
            </Text>
          </Text>
          <Text style={styles.upgradeBody}>
            {tr('Activa PRO para ver al cliente, confirmar reservas y recibir su contacto directo.')}
          </Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => setPlanPickerOpen(true)}
          >
            <Ionicons name="flash" size={16} color={COLORS.white} />
            <Text style={styles.upgradeBtnText}>{tr('Activar PRO')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* FREE PARTNER without leads: soft prompt */}
      {!isPro && stats && (stats.locked_leads_count || 0) === 0 ? (
        <TouchableOpacity onPress={() => setPlanPickerOpen(true)} style={styles.upgradeBannerSoft}>
          <Ionicons name="lock-closed" size={16} color={COLORS.primary} />
          <Text style={styles.upgradeSoftText}>
            {tr('Cuenta FREE — tu perfil está visible pero aún no recibes solicitudes activas. ')}
            <Text style={{ color: COLORS.primary, ...FONTS.bold }}>{tr('Activar PRO')}</Text>
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Tab selector */}
      <View style={styles.tabRow}>
        {([
          { key: 'pending', label: tr('Por confirmar'), badge: stats?.pending_count },
          { key: 'upcoming', label: tr('Próximas') },
          { key: 'history', label: tr('Historial') },
        ] as { key: FilterTab; label: string; badge?: number }[]).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            {t.badge ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{t.badge}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>
              {tab === 'pending'
                ? tr('No tienes solicitudes pendientes.')
                : tab === 'upcoming'
                ? tr('No tienes reservas próximas confirmadas.')
                : tr('Sin historial de reservas aún.')}
            </Text>
            {tab === 'pending' ? (
              <Text style={styles.emptyHint}>
                {tr('Cuando llegue una solicitud aparecerá aquí. Mantén tu perfil completo para recibir más reservas.')}
              </Text>
            ) : null}
          </View>
        ) : (
          filtered.map((r) => {
            const meta = STATUS_META[r.status] || { label: r.status, color: COLORS.textMuted, bg: 'rgba(148,163,184,0.15)' };
            return (
              <View key={r.reservation_id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarText}>
                      {(r.user_name || r.user_email || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {r.user_name || r.user_email || tr('Cliente')}
                    </Text>
                    <Text style={styles.cardSub}>
                      {fmtDate(r.date)}{r.time ? ` · ${r.time}` : ''} · {r.party_size} {tr('pers.')}
                    </Text>
                    <Text style={styles.cardSubFaint}>
                      {tr('Solicitada')} {fmtRelative(r.created_at)}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                    <Text style={[styles.statusText, { color: meta.color }]}>{tr(meta.label)}</Text>
                  </View>
                </View>

                {r.event?.title ? (
                  <View style={styles.eventChip}>
                    <Ionicons name="ticket-outline" size={12} color="#A78BFA" />
                    <Text style={styles.eventChipText}>{r.event.title}</Text>
                  </View>
                ) : null}

                {r.notes ? (
                  <View style={styles.notesBox}>
                    <Ionicons name="chatbox-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.notesText}>"{r.notes}"</Text>
                  </View>
                ) : null}

                {r.partner_note && r.status === 'confirmed' ? (
                  <Text style={styles.youSaid}>
                    {tr('Tu nota:')} <Text style={{ fontStyle: 'italic' }}>"{r.partner_note}"</Text>
                  </Text>
                ) : null}
                {r.partner_rejection_reason ? (
                  <Text style={styles.rejectionReason}>
                    {tr('Motivo:')} <Text style={{ fontStyle: 'italic' }}>"{r.partner_rejection_reason}"</Text>
                  </Text>
                ) : null}

                {/* Action buttons by status */}
                {r.status === 'pending_confirmation' && isPro ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.confirmBtn} onPress={() => openModal(r, 'confirm')}>
                      <Ionicons name="checkmark" size={16} color={COLORS.white} />
                      <Text style={styles.confirmBtnText}>{tr('Confirmar')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => openModal(r, 'reject')}>
                      <Ionicons name="close" size={16} color="#EF4444" />
                      <Text style={styles.rejectBtnText}>{tr('Rechazar')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : r.status === 'pending_partner_activation' || (r.status === 'pending_confirmation' && !isPro) ? (
                  <TouchableOpacity
                    style={styles.lockedActionRow}
                    onPress={() => setPlanPickerOpen(true)}
                  >
                    <Ionicons name="lock-closed" size={14} color={COLORS.primary} />
                    <Text style={styles.lockedActionText}>
                      {tr('Activa PRO para ver al cliente y confirmar')}
                    </Text>
                    <Ionicons name="arrow-forward" size={14} color={COLORS.primary} />
                  </TouchableOpacity>
                ) : r.status === 'confirmed' ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.whatsappBtn} onPress={() => openWhatsApp(r)}>
                      <Ionicons name="logo-whatsapp" size={16} color={COLORS.white} />
                      <Text style={styles.whatsappBtnText}>WhatsApp</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.completeBtn} onPress={() => quickAction(r, 'complete')}>
                      <Ionicons name="checkmark-done" size={14} color="#22C55E" />
                      <Text style={styles.completeBtnText}>{tr('Completada')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.noShowBtn} onPress={() => quickAction(r, 'no_show')}>
                      <Ionicons name="person-remove-outline" size={14} color="#EF4444" />
                      <Text style={styles.noShowBtnText}>{tr('No-show')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Plan Picker Modal — shown when FREE partner taps a locked CTA */}
      <Modal visible={planPickerOpen} transparent animationType="slide" onRequestClose={() => setPlanPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.planModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.planModalTitle}>{tr('Elige tu plan')}</Text>
              <TouchableOpacity onPress={() => setPlanPickerOpen(false)}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.planModalSub}>
              {tr('Activa tu cuenta para gestionar reservas y desbloquear todas las solicitudes.')}
            </Text>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {([
                {
                  key: 'free',
                  name: 'FREE',
                  price: 'Gratis',
                  highlight: false,
                  features: [
                    { ok: true, label: tr('Perfil visible en el app') },
                    { ok: true, label: tr('Recibes notificaciones de demanda') },
                    { ok: false, label: tr('Ver datos de cliente') },
                    { ok: false, label: tr('Confirmar reservas') },
                    { ok: false, label: tr('Eventos y promociones') },
                  ],
                },
                {
                  key: 'pro',
                  name: 'PRO',
                  price: '$150.000 COP/mes',
                  highlight: true,
                  badge: tr('Recomendado'),
                  features: [
                    { ok: true, label: tr('Todo lo de FREE') },
                    { ok: true, label: tr('Ver nombre, WhatsApp y email del cliente') },
                    { ok: true, label: tr('Confirmar / rechazar reservas') },
                    { ok: true, label: tr('Link de pago directo al cliente') },
                    { ok: true, label: tr('WhatsApp con saludo pre-llenado') },
                    { ok: true, label: tr('Publicar eventos y promociones') },
                    { ok: true, label: tr('Estadísticas completas') },
                  ],
                },
                {
                  key: 'elite',
                  name: 'ELITE',
                  price: '$500.000 COP/mes',
                  highlight: false,
                  features: [
                    { ok: true, label: tr('Todo lo de PRO') },
                    { ok: true, label: tr('Posición destacada en categorías') },
                    { ok: true, label: tr('Banner de patrocinador en home') },
                    { ok: true, label: tr('Acceso a datos demográficos de Alcaldía') },
                    { ok: true, label: tr('Soporte prioritario WhatsApp 24/7') },
                    { ok: true, label: tr('CRM con segmentación de clientes') },
                  ],
                },
              ] as const).map((plan) => (
                <View
                  key={plan.key}
                  style={[styles.planCard, plan.highlight && styles.planCardHighlight]}
                >
                  <View style={styles.planCardHeader}>
                    <Text style={[styles.planCardName, plan.highlight && { color: COLORS.primary }]}>
                      {plan.name}
                    </Text>
                    {plan.highlight && (plan as any).badge ? (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeText}>{(plan as any).badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.planPrice}>{plan.price}</Text>
                  <View style={{ gap: 5, marginTop: 4 }}>
                    {plan.features.map((f, i) => (
                      <View key={i} style={styles.featureRow}>
                        <Ionicons
                          name={f.ok ? 'checkmark-circle' : 'close-circle'}
                          size={14}
                          color={f.ok ? '#22C55E' : '#94A3B8'}
                        />
                        <Text style={[styles.featureText, !f.ok && { opacity: 0.5 }]}>{f.label}</Text>
                      </View>
                    ))}
                  </View>
                  {plan.key !== 'free' ? (
                    <TouchableOpacity
                      style={[
                        styles.planActivateBtn,
                        { backgroundColor: plan.highlight ? COLORS.primary : '#1F2937' },
                      ]}
                      onPress={() => {
                        const msg = encodeURIComponent(
                          `Hola Amo Cartagena, quiero activar el plan ${plan.name} ($${plan.price}) para mi negocio "${reservations[0]?.partner_name || ''}". ¿Cómo procedo?`,
                        );
                        Linking.openURL(`https://wa.me/${process.env.EXPO_PUBLIC_AMO_WHATSAPP || '573176481183'}?text=${msg}`).catch(() => {});
                        setPlanPickerOpen(false);
                      }}
                    >
                      <Ionicons name="flash" size={15} color={COLORS.white} />
                      <Text style={styles.planActivateText}>
                        {tr(`Activar ${plan.name}`)}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.planCurrentBadge}>
                      <Ionicons name="checkmark" size={13} color={COLORS.textMuted} />
                      <Text style={styles.planCurrentText}>{tr('Tu plan actual')}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Confirm / Reject Modal */}
      <Modal visible={!!modalRes} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalAction === 'confirm' ? tr('Confirmar reserva') : tr('Rechazar reserva')}
              </Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              {modalRes?.user_name || tr('Cliente')} · {modalRes && fmtDate(modalRes.date)}{modalRes?.time ? ` ${modalRes.time}` : ''} · {modalRes?.party_size} {tr('pers.')}
            </Text>
            <Text style={styles.modalLabel}>
              {modalAction === 'confirm' ? tr('Mensaje opcional al cliente') : tr('Motivo del rechazo (opcional)')}
            </Text>
            <TextInput
              value={modalNote}
              onChangeText={(v) => setModalNote(v.slice(0, 280))}
              placeholder={
                modalAction === 'confirm'
                  ? tr('Ej: Te esperamos en la terraza, mesa #5')
                  : tr('Ej: Lleno completo ese día, ¿probamos otra fecha?')
              }
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={3}
              style={styles.modalInput}
              maxLength={280}
            />
            <Text style={styles.modalHint}>
              {modalAction === 'confirm'
                ? tr('Al confirmar, el cliente verá tu link de pago automáticamente en su app.')
                : tr('El cliente recibirá una notificación del rechazo.')}
            </Text>
            <TouchableOpacity
              style={[
                styles.modalSubmit,
                { backgroundColor: modalAction === 'confirm' ? '#22C55E' : '#EF4444' },
                actionLoading && { opacity: 0.6 },
              ]}
              onPress={submitAction}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name={modalAction === 'confirm' ? 'checkmark' : 'close'} size={18} color={COLORS.white} />
                  <Text style={styles.modalSubmitText}>
                    {modalAction === 'confirm' ? tr('Confirmar reserva') : tr('Rechazar reserva')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },

  statsBanner: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, ...FONTS.bold },
  statLabel: { color: COLORS.textMuted, fontSize: 10.5, ...FONTS.medium, textAlign: 'center' },
  statDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 6 },

  upgradeBanner: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderWidth: 1.5,
    borderColor: '#22C55E',
    gap: 8,
  },
  upgradeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upgradeTitle: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold, flex: 1 },
  upgradeValue: { color: COLORS.textMain, fontSize: 13 },
  upgradeBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16 },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    backgroundColor: '#22C55E',
    marginTop: 4,
  },
  upgradeBtnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold, letterSpacing: 0.4 },

  upgradeBannerSoft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    padding: 10,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(217,119,6,0.08)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  upgradeSoftText: { color: COLORS.textMain, fontSize: 11.5, flex: 1, lineHeight: 16 },

  lockedActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  lockedActionText: { color: COLORS.primary, fontSize: 12.5, ...FONTS.bold, flex: 1, textAlign: 'center' },

  tabRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontSize: 12, ...FONTS.medium },
  tabTextActive: { color: COLORS.white, ...FONTS.bold },
  tabBadge: { backgroundColor: '#F59E0B', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeText: { color: COLORS.white, fontSize: 10, ...FONTS.bold },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 280 },
  emptyHint: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', maxWidth: 280, fontStyle: 'italic' },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: { color: COLORS.white, fontSize: 18, ...FONTS.bold },
  userName: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },
  cardSub: { color: COLORS.textMain, fontSize: 12, marginTop: 2, ...FONTS.medium },
  cardSubFaint: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 2 },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    maxWidth: 120,
  },
  statusText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3, textAlign: 'center' },

  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  eventChipText: { color: '#A78BFA', fontSize: 11, ...FONTS.medium },

  notesBox: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    padding: 8,
    alignItems: 'flex-start',
  },
  notesText: { color: COLORS.textMain, fontSize: 11.5, flex: 1, lineHeight: 16 },

  youSaid: { color: COLORS.textMuted, fontSize: 11.5 },
  rejectionReason: { color: '#EF4444', fontSize: 11.5 },

  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: '#22C55E',
  },
  confirmBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  rejectBtnText: { color: '#EF4444', fontSize: 13, ...FONTS.bold },
  whatsappBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    backgroundColor: '#25D366',
  },
  whatsappBtnText: { color: COLORS.white, fontSize: 12.5, ...FONTS.bold },
  completeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  completeBtnText: { color: '#22C55E', fontSize: 11.5, ...FONTS.bold },
  noShowBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  noShowBtnText: { color: '#EF4444', fontSize: 11.5, ...FONTS.bold },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? 36 : SPACING.md,
    gap: 10,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },
  modalSub: { color: COLORS.textMuted, fontSize: 12.5 },
  modalLabel: { color: COLORS.textMain, fontSize: 12, ...FONTS.bold, marginTop: 6 },
  modalInput: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textMain,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalHint: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic' },
  modalSubmit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginTop: 6,
  },
  modalSubmitText: { color: COLORS.white, fontSize: 15, ...FONTS.bold },

  // Plan picker modal
  planModalCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? 36 : SPACING.md,
    maxHeight: '92%',
  },
  planModalTitle: { color: COLORS.textMain, fontSize: 19, ...FONTS.bold },
  planModalSub: { color: COLORS.textMuted, fontSize: 12.5, marginBottom: 12, lineHeight: 17 },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  planCardHighlight: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'rgba(217,119,6,0.05)',
  },
  planCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardName: { color: COLORS.textMain, fontSize: 18, ...FONTS.bold, letterSpacing: 1 },
  planBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  planBadgeText: { color: COLORS.white, fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  planPrice: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold, marginBottom: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featureText: { color: COLORS.textMain, fontSize: 12, flex: 1, lineHeight: 17 },
  planActivateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    marginTop: 8,
  },
  planActivateText: { color: COLORS.white, fontSize: 13, ...FONTS.bold, letterSpacing: 0.3 },
  planCurrentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 7,
  },
  planCurrentText: { color: COLORS.textMuted, fontSize: 11.5, ...FONTS.medium },
});
