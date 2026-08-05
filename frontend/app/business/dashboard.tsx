import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Platform } from 'react-native';
import { SafeImage } from '../../src/components/SafeImage';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { TierBadge } from '../../src/components/TierBadge';
import AlcaldiaDashboard from '../../src/components/AlcaldiaDashboard';
import { useTr } from '../../src/i18n/autoTr';

type Stats = { total_events: number; upcoming_events: number; total_views: number; total_reserves: number; };
type Onboarding = { percent: number; is_public: boolean; status: string; missing: string[] };

const MISSING_LABELS: Record<string, string> = {
  name: 'Nombre',
  category: 'Categoría',
  address: 'Dirección',
  phone: 'Teléfono',
  whatsapp: 'WhatsApp',
  experience: 'Descripción / experiencia',
  instagram: 'Instagram',
  schedule: 'Horarios',
  default_payment_link: 'Link de pago / reserva',
  photos: 'Fotos del lugar',
};

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía', music: 'Música', party: 'Fiesta',
  wellness: 'Wellness', art: 'Arte & Cultura', popup: 'Pop-up',
};

export default function BusinessDashboard() {
  const tr = useTr();
  const router = useRouter();
  const { token, business, partner, loading: authLoading, logout, refresh } = useBusinessAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reservationStats, setReservationStats] = useState<{ pending_count?: number } | null>(null);
  const [membership, setMembership] = useState<any | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forcePartnerView, setForcePartnerView] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [eventsData, statsData, reservData, memData, onbData] = await Promise.all([
        api.get('/business/events', { headers: { Authorization: `Bearer ${token}` } }),
        api.get('/business/stats', { headers: { Authorization: `Bearer ${token}` } }),
        api.get('/business/reservations?limit=1', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        api.get('/business/membership', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        api.get('/business/onboarding-status', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
      ]);
      setEvents(eventsData);
      setStats(statsData);
      setReservationStats(reservData?.stats || null);
      setMembership(memData || null);
      setOnboarding(onbData || null);
    } catch (e) { console.error(e); }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace('/business/login');
      return;
    }
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [token, authLoading, load, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('¿Quieres cerrar tu sesión business?')) {
        await logout();
        router.replace('/business/login');
      }
    } else {
      Alert.alert('Cerrar sesión', '¿Quieres cerrar tu sesión business?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: async () => { await logout(); router.replace('/business/login'); } },
      ]);
    }
  };

  const handleDelete = (eventId: string, title: string) => {
    Alert.alert('Eliminar evento', `¿Seguro que quieres eliminar "${title}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/business/events/${eventId}`, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e: any) { Alert.alert('Error', e?.message || 'No se pudo eliminar'); return; }
        // Optimistically remove from local state (static mode reload returns same list)
        setEvents((prev: any[]) => prev.filter((e: any) => e.event_id !== eventId));
      } },
    ]);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), load()]);
    setRefreshing(false);
  }, [refresh, load]);

  if (authLoading || loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  const tierColors = partner?.tier ? TIER_COLORS[partner.tier as Tier] : null;
  const isGovernment = business?.role === 'government';
  // B1: edit rights require a VERIFIED claim. A partner with no venue yet, or a
  // pending/unverified claim, sees the "find your business" flow instead of the
  // (non-functional) venue dashboard.
  const claimStatus = partner?.claim_status;
  const needsClaim = !isGovernment && (!partner || claimStatus !== 'verified_owner');

  if (isGovernment && token && !forcePartnerView) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="close" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Panel Alcaldía</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => router.push('/business/admin/queue' as any)} style={styles.headerBtn}>
              <Ionicons name="albums-outline" size={21} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/business/change-password' as any)} style={styles.headerBtn}>
              <Ionicons name="key-outline" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.headerBtn}>
              <Ionicons name="log-out-outline" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        <AlcaldiaDashboard
          token={token}
          business={business}
          partner={partner}
          onEditProfile={() => router.push('/business/profile-edit')}
          onCreateEvent={() => router.push('/business/event-form')}
          onMyEvents={() => setForcePartnerView(true)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (isGovernment) {
              setForcePartnerView(false);
            } else {
              router.back();
            }
          }}
          style={styles.headerBtn}
        >
          <Ionicons name={isGovernment ? 'arrow-back' : 'close'} size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isGovernment ? 'Mis publicaciones' : 'Dashboard'}</Text>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={() => router.push('/business/change-password' as any)} style={styles.headerBtn}>
            <Ionicons name="key-outline" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.headerBtn}>
            <Ionicons name="log-out-outline" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />} contentContainerStyle={{ paddingBottom: 100 }}>
        {needsClaim && (
          <View style={styles.claimGate}>
            <View style={styles.claimIcon}>
              <Ionicons name={claimStatus === 'pending_verification' ? 'hourglass-outline' : 'storefront-outline'} size={34} color={COLORS.primary} />
            </View>
            {claimStatus === 'pending_verification' ? (
              <>
                <Text style={styles.claimTitle}>{tr('Verificación en proceso')}</Text>
                <Text style={styles.claimSub}>{tr('Estamos revisando tu solicitud de propiedad. Podrás editar tu negocio cuando sea verificada.')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.claimTitle}>{tr('Encuentra tu negocio')}</Text>
                <Text style={styles.claimSub}>{tr('Busca tu negocio en el catálogo y verifica que eres el dueño para empezar a gestionarlo.')}</Text>
                <TouchableOpacity style={styles.claimCta} onPress={() => router.push('/business/find' as any)}>
                  <Ionicons name="search" size={18} color={COLORS.white} />
                  <Text style={styles.claimCtaText}>{tr('Buscar mi negocio')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        {!needsClaim && (<>
        {/* Partner Profile Card */}
        <View style={[styles.profileCard, tierColors && { borderColor: tierColors.border, borderWidth: 1.5 }]}>
          {partner?.image_url ? (
            <SafeImage uri={partner.image_url} style={styles.profileImage} />
          ) : <View style={[styles.profileImage, { backgroundColor: COLORS.surface }]} />}
          <View style={styles.profileOverlay} />
          <View style={styles.profileContent}>
            <View style={styles.profileBadgeRow}>
              <TierBadge tier={partner?.tier} size="sm" />
              <View style={styles.verifiedBadge}>
                <Ionicons name={partner?.catalog_status === 'pending_review' ? 'hourglass-outline' : 'shield-checkmark'} size={12} color={COLORS.primary} />
                <Text style={styles.verifiedText}>{partner?.catalog_status === 'pending_review' ? tr('EN REVISIÓN') : tr('DUEÑO VERIFICADO')}</Text>
              </View>
            </View>
            <Text style={styles.partnerName}>{partner?.name || business?.full_name}</Text>
            <Text style={styles.partnerEmail}>{business?.email}</Text>
          </View>
          <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/business/profile-edit')}>
            <Ionicons name="create-outline" size={16} color={COLORS.primary} />
            <Text style={styles.editProfileText}>{tr('Editar perfil')}</Text>
          </TouchableOpacity>
        </View>

        {/* B2: Mi contenido — photos, prices, submission status */}
        <TouchableOpacity style={styles.contentLink} onPress={() => router.push('/business/content' as any)} activeOpacity={0.85}>
          <View style={styles.contentIconWrap}><Ionicons name="images-outline" size={18} color={COLORS.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contentTitle}>{tr('Mi contenido')}</Text>
            <Text style={styles.contentSub}>{tr('Sube fotos, envía tu precio y revisa el estado')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Onboarding / Approval banner (non-government) */}
        {!isGovernment && onboarding ? (() => {
          const pct = onboarding.percent ?? 0;
          const isApproved = !!onboarding.is_public;
          const isSuspended = onboarding.status === 'suspended';
          const missing = onboarding.missing || [];
          // If everything is done and approved, hide the banner entirely
          if (isApproved && pct >= 100) return null;
          let bgColor = 'rgba(245,158,11,0.10)';
          let borderColor = '#F59E0B';
          let iconName: any = 'time-outline';
          let iconColor = '#F59E0B';
          let title = tr('Completa tu perfil para empezar a recibir reservas');
          let subtitle = tr(`${pct}% completado · faltan ${missing.length} datos clave`);
          if (isSuspended) {
            bgColor = 'rgba(239,68,68,0.10)'; borderColor = '#EF4444'; iconColor = '#EF4444'; iconName = 'pause-circle';
            title = tr('Tu perfil está suspendido');
            subtitle = tr('Contacta al equipo Amo Cartagena para reactivarlo.');
          } else if (pct >= 100 && !isApproved) {
            bgColor = 'rgba(59,130,246,0.10)'; borderColor = '#3B82F6'; iconColor = '#3B82F6'; iconName = 'shield-checkmark';
            title = tr('Perfil completo — en revisión');
            subtitle = tr('El equipo Amo Cartagena revisará tu perfil antes de hacerlo público (suele tomar <24h).');
          }
          return (
            <TouchableOpacity
              testID="onboarding-banner"
              style={[styles.onbBanner, { backgroundColor: bgColor, borderColor }]}
              onPress={() => router.push('/business/profile-edit' as any)}
              activeOpacity={0.9}
              disabled={pct >= 100}
            >
              <View style={[styles.onbIconWrap, { backgroundColor: borderColor + '22', borderColor }]}>
                <Ionicons name={iconName} size={20} color={iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.onbTitle}>{title}</Text>
                <Text style={styles.onbSub}>{subtitle}</Text>
                {/* Progress bar */}
                {!isSuspended && (
                  <View style={styles.onbProgressTrack}>
                    <View style={[styles.onbProgressFill, { width: `${pct}%`, backgroundColor: borderColor }]} />
                  </View>
                )}
                {/* Missing fields chips (max 4) */}
                {!isApproved && pct < 100 && missing.length > 0 && (
                  <View style={styles.onbChipsRow}>
                    {missing.slice(0, 4).map(k => (
                      <View key={k} style={styles.onbChip}>
                        <Ionicons name="alert-circle" size={10} color={iconColor} />
                        <Text style={[styles.onbChipText, { color: iconColor }]}>
                          {MISSING_LABELS[k] || k}
                        </Text>
                      </View>
                    ))}
                    {missing.length > 4 && (
                      <Text style={styles.onbMoreText}>+{missing.length - 4}</Text>
                    )}
                  </View>
                )}
              </View>
              {pct < 100 && <Ionicons name="chevron-forward" size={20} color={borderColor} />}
            </TouchableOpacity>
          );
        })() : null}
        <View style={styles.statsGrid}>
          <TouchableOpacity
            testID="stat-card-upcoming"
            style={styles.statCard}
            onPress={() => router.push('/business/stats?type=upcoming' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={20} color={COLORS.primary} />
            <Text style={styles.statValue}>{stats?.upcoming_events || 0}</Text>
            <Text style={styles.statLabel}>{tr('Próximos')}</Text>
            <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} style={styles.statChevron} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="stat-card-views"
            style={styles.statCard}
            onPress={() => router.push('/business/stats?type=views' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="eye" size={20} color="#22C55E" />
            <Text style={styles.statValue}>{stats?.total_views || 0}</Text>
            <Text style={styles.statLabel}>{tr('Vistas')}</Text>
            <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} style={styles.statChevron} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="stat-card-reservations"
            style={styles.statCard}
            onPress={() => router.push('/business/stats?type=reservations' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={20} color="#A855F7" />
            <Text style={styles.statValue}>{stats?.total_reserves || 0}</Text>
            <Text style={styles.statLabel}>{tr('Reservas')}</Text>
            <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} style={styles.statChevron} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="stat-card-total"
            style={styles.statCard}
            onPress={() => router.push('/business/stats?type=total' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="layers" size={20} color="#F59E0B" />
            <Text style={styles.statValue}>{stats?.total_events || 0}</Text>
            <Text style={styles.statLabel}>{tr('Total')}</Text>
            <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} style={styles.statChevron} />
          </TouchableOpacity>
        </View>

        {/* Reservations CTA Card */}
        <TouchableOpacity
          style={styles.reservationsCta}
          onPress={() => router.push('/business/reservations' as any)}
          activeOpacity={0.85}
        >
          <View style={styles.reservationsIcon}>
            <Ionicons name="calendar" size={22} color={COLORS.white} />
            {reservationStats && (reservationStats.pending_count || 0) > 0 ? (
              <View style={styles.reservationsBadge}>
                <Text style={styles.reservationsBadgeText}>
                  {Math.min(99, reservationStats.pending_count || 0)}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reservationsTitle}>{tr('Reservas entrantes')}</Text>
            <Text style={styles.reservationsSub}>
              {reservationStats && (reservationStats.pending_count || 0) > 0
                ? tr(`${reservationStats.pending_count} solicitud(es) por confirmar`)
                : tr('Confirma o rechaza solicitudes de tus clientes')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
        </TouchableOpacity>

        {/* Membership Card */}
        {membership ? (
          <View style={styles.membershipCard}>
            <View style={styles.membershipHeader}>
              <Ionicons name="ribbon" size={18} color={COLORS.primary} />
              <Text style={styles.membershipTitle}>{tr('Tu membresía')}</Text>
              <View
                style={[
                  styles.memberStatusBadge,
                  {
                    backgroundColor:
                      membership.membership_status === 'active'
                        ? 'rgba(34,197,94,0.15)'
                        : membership.membership_status === 'suspended' || membership.membership_status === 'expired'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(245,158,11,0.15)',
                    borderColor:
                      membership.membership_status === 'active'
                        ? '#22C55E'
                        : membership.membership_status === 'suspended' || membership.membership_status === 'expired'
                        ? '#EF4444'
                        : '#F59E0B',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.memberStatusText,
                    {
                      color:
                        membership.membership_status === 'active'
                          ? '#22C55E'
                          : membership.membership_status === 'suspended' || membership.membership_status === 'expired'
                          ? '#EF4444'
                          : '#F59E0B',
                    },
                  ]}
                >
                  {tr(membership.membership_status === 'active'
                    ? 'Activa'
                    : membership.membership_status === 'pending'
                    ? 'Pendiente'
                    : membership.membership_status === 'suspended'
                    ? 'Suspendida'
                    : 'Expirada')}
                </Text>
              </View>
            </View>
            <View style={styles.membershipBody}>
              <Text style={styles.membershipTier}>
                {tr('Plan')}: <Text style={{ ...FONTS.bold, color: COLORS.primary }}>
                  {String(membership.membership_tier || 'popular').toUpperCase()}
                </Text>
              </Text>
              <Text style={styles.membershipFee}>
                {membership.monthly_fee_cop > 0
                  ? `$${Number(membership.monthly_fee_cop).toLocaleString('es-CO')} COP / ${tr('mes')}`
                  : tr('Gratis')}
              </Text>
              {membership.days_left !== null && membership.days_left !== undefined ? (
                <Text style={styles.membershipExpiry}>
                  {membership.days_left > 0
                    ? tr(`Vence en ${membership.days_left} días`)
                    : tr('Tu membresía venció. Contacta a Alcaldía.')}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Events Section */}
        <View style={styles.eventsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Mis eventos</Text>
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/business/event-form')}>
              <Ionicons name="add" size={18} color={COLORS.white} />
              <Text style={styles.newBtnText}>Nuevo</Text>
            </TouchableOpacity>
          </View>

          {events.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>Aún no tienes eventos</Text>
              <Text style={styles.emptyText}>Crea tu primer evento y aparecerá en la agenda "Salir Hoy"</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/business/event-form')}>
                <Text style={styles.emptyBtnText}>Crear primer evento</Text>
              </TouchableOpacity>
            </View>
          ) : (
            events.map((ev: any) => {
              const today = new Date().toISOString().slice(0, 10);
              const isPast = ev.date < today;
              return (
                <View key={ev.event_id} style={[styles.eventCard, isPast && { opacity: 0.55 }]}>
                  <SafeImage uri={ev.flyer_url || partner?.image_url} style={styles.eventThumb} />
                  <View style={styles.eventBody}>
                    <View style={styles.eventTopRow}>
                      <Text style={styles.eventDate}>{ev.date} · {ev.start_time}</Text>
                      {isPast && <Text style={styles.pastTag}>FINALIZADO</Text>}
                      {ev.moderation_status === 'pending' && (
                        <View style={[styles.modTag, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                          <Ionicons name="time" size={9} color="#F59E0B" />
                          <Text style={[styles.modTagText, { color: '#F59E0B' }]}>EN REVISIÓN</Text>
                        </View>
                      )}
                      {ev.moderation_status === 'rejected' && (
                        <View style={[styles.modTag, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                          <Ionicons name="close-circle" size={9} color="#EF4444" />
                          <Text style={[styles.modTagText, { color: '#EF4444' }]}>RECHAZADO</Text>
                        </View>
                      )}
                      {ev.moderation_status === 'approved' && ev.category_auto_corrected && (
                        <View style={[styles.modTag, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                          <Ionicons name="sparkles" size={9} color="#A855F7" />
                          <Text style={[styles.modTagText, { color: '#A855F7' }]}>IA AJUSTÓ</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                    <View style={styles.eventStats}>
                      <Text style={styles.eventCat}>{CAT_LABELS[ev.category] || ev.category}</Text>
                      <Text style={styles.eventMeta}>· 👁 {ev.views_count || 0}</Text>
                      <Text style={styles.eventMeta}>· ⚡ {ev.reserve_clicks || 0}</Text>
                    </View>
                    <View style={styles.eventActions}>
                      <TouchableOpacity style={styles.editBtn} onPress={() => router.push({ pathname: '/business/event-form', params: { eventId: ev.event_id } })}>
                        <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.editText}>{tr('Editar')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.delBtn} onPress={() => handleDelete(ev.event_id, ev.title)}>
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  claimGate: { alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl * 1.5, paddingBottom: SPACING.xl },
  claimIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,119,6,0.15)', borderWidth: 1.5, borderColor: COLORS.primary },
  claimTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center', marginTop: SPACING.lg },
  claimSub: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, marginTop: SPACING.sm, paddingHorizontal: SPACING.sm },
  claimCta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, paddingHorizontal: SPACING.xl, marginTop: SPACING.xl },
  claimCtaText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },

  profileCard: { margin: SPACING.lg, borderRadius: RADIUS.xl, overflow: 'hidden', height: 180, position: 'relative' },
  profileImage: { position: 'absolute', width: '100%', height: '100%' },
  profileOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.7)' },
  profileContent: { flex: 1, padding: SPACING.md, justifyContent: 'center' },
  profileBadgeRow: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.sm },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(217,119,6,0.2)', borderWidth: 1, borderColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  verifiedText: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.8 },
  partnerName: { fontSize: 22, color: COLORS.white, ...FONTS.bold },
  partnerEmail: { fontSize: 12, color: 'rgba(255,255,255,0.7)', ...FONTS.regular, marginTop: 2 },
  editProfileBtn: { position: 'absolute', bottom: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(217,119,6,0.2)', borderWidth: 1, borderColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full },
  editProfileText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.5 },
  contentLink: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  contentIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,119,6,0.15)' },
  contentTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  contentSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  statsGrid: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: '22%', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, gap: 2, position: 'relative' },
  statChevron: { position: 'absolute', top: 6, right: 6, opacity: 0.7 },
  statValue: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  statLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.3, textTransform: 'uppercase' },

  eventsSection: { paddingHorizontal: SPACING.lg, marginTop: SPACING.lg },

  // Onboarding banner
  onbBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    padding: 14,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  onbIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  onbTitle: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },
  onbSub: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  onbProgressTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  onbProgressFill: { height: 6, borderRadius: 3 },
  onbChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  onbChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  onbChipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.2 },
  onbMoreText: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.semibold, alignSelf: 'center' },

  reservationsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  reservationsIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  reservationsBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  reservationsBadgeText: { color: COLORS.white, fontSize: 11, ...FONTS.bold },
  reservationsTitle: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },
  reservationsSub: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 2 },

  membershipCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  membershipHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  membershipTitle: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold, flex: 1 },
  memberStatusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: RADIUS.full, borderWidth: 1 },
  memberStatusText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  membershipBody: { gap: 4 },
  membershipTier: { color: COLORS.textMain, fontSize: 13 },
  membershipFee: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold },
  membershipExpiry: { color: COLORS.textMuted, fontSize: 11.5, fontStyle: 'italic' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full },
  newBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },

  empty: { alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  emptyTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold, marginTop: SPACING.xs },
  emptyText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADIUS.full, marginTop: SPACING.sm },
  emptyBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },

  eventCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm, overflow: 'hidden' },
  eventThumb: { width: 80, height: 110 },
  eventBody: { flex: 1, padding: SPACING.sm, justifyContent: 'space-between' },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventDate: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.3 },
  pastTag: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.5 },
  draftTag: { fontSize: 9, color: '#F59E0B', ...FONTS.bold, letterSpacing: 0.5, backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  modTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  modTagText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.5 },
  eventTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold, marginVertical: 4 },
  eventStats: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  eventCat: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  eventMeta: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  eventActions: { flexDirection: 'row', gap: SPACING.xs, marginTop: 6 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  editText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  delBtn: { width: 32, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
});
