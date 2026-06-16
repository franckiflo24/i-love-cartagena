import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, FlatList, Linking, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useFavorites } from '../src/context/FavoritesContext';
import { useTr } from '../src/i18n/autoTr';
import { SafeImage } from '../src/components/SafeImage';
import PaymentSheet from '../src/components/PaymentSheet';
import type { PaymentResult } from '../src/lib/payments';

type Concert = {
  concert_id: string; artist: string; title: string; genre: string;
  description: string; date: string; start_time: string; end_time: string;
  venue_name: string; is_free: boolean; price: number; currency: string;
  image_url: string; ticket_link: string; lineup: string[];
  capacity: number; tags: string[];
};

const GENRE_COLORS: Record<string, string> = {
  'Deep House': '#D97706',
  'Melodic Techno': '#D97706',
  'Reggaeton': '#EC4899',
  'Latin Pop': '#EC4899',
  'Trap Latino': '#EC4899',
  'UK Garage': '#8B5CF6',
  'House': '#8B5CF6',
  'Afro House': '#8B5CF6',
  'Salsa': '#EF4444',
  'Son Cubano': '#EF4444',
  'Chill': '#06B6D4',
  'Downtempo': '#06B6D4',
  'Minimal Techno': '#22C55E',
  'Jazz': '#F59E0B',
  'Bossa Nova': '#F59E0B',
  'Cumbia': '#F97316',
  'Melodic House': '#3B82F6',
  'Progressive': '#3B82F6',
  'Multi-género': '#D97706',
};

const GENRE_FILTERS = [
  { key: 'house', label: 'Electro', color: '#D97706' },
  { key: 'reggaeton', label: 'Reggaeton', color: '#EC4899' },
  { key: 'salsa', label: 'Salsa', color: '#EF4444' },
  { key: 'jazz', label: 'Jazz', color: '#F59E0B' },
  { key: 'techno', label: 'Techno', color: '#22C55E' },
  { key: 'cumbia', label: 'Cumbia', color: '#F97316' },
  { key: 'chill', label: 'Chill', color: '#06B6D4' },
  { key: 'afro', label: 'Afro House', color: '#8B5CF6' },
];

const getGenreColor = (genre: string) => {
  for (const [key, color] of Object.entries(GENRE_COLORS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return COLORS.primary;
};

const formatDateLabel = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return { day: days[d.getDay()], date: d.getDate(), month: months[d.getMonth()] };
};

const formatPrice = (price: number) => {
  if (price >= 1000) return `$${(price / 1000).toFixed(0)}K`;
  return `$${price}`;
};

export default function ConcertsScreen() {
  const tr = useTr();
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paySheetVisible, setPaySheetVisible] = useState(false);
  const [payConcert, setPayConcert] = useState<Concert | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [d, c, g] = await Promise.all([
          api.get('/concerts/dates'),
          api.get('/concerts'),
          api.get('/concerts/genres'),
        ]);
        setDates(d);
        setConcerts(c);
        setGenres(g);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);

  const filteredConcerts = concerts.filter(c => {
    if (selectedDate && c.date !== selectedDate) return false;
    if (selectedGenre && !c.genre.toLowerCase().includes(selectedGenre.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    // Upcoming first, past last
    const aPast = a.date < todayStr ? 1 : 0;
    const bPast = b.date < todayStr ? 1 : 0;
    if (aPast !== bPast) return aPast - bPast;
    return a.date.localeCompare(b.date);
  });

  const openTicketLink = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  const shareConcert = async (concert: Concert) => {
    const priceText = concert.is_free ? 'GRATIS' : `$${(concert.price / 1000).toFixed(0)}K COP`;
    try {
      await Share.share({
        message: `🎵 ${concert.artist} - ${concert.title}\n📍 ${concert.venue_name}\n🗓 ${concert.date} · ${concert.start_time}-${concert.end_time}\n🎶 ${concert.genre}\n💰 ${priceText}\n\nDescarga Amo Cartagena para ver todo el programa 🎧`,
      });
    } catch (e) { console.error(e); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Conciertos')}</Text>
          <Text style={styles.subtitle}>Programa musical · {concerts.length} shows</Text>
        </View>
        <Ionicons name="musical-notes" size={24} color={COLORS.primary} />
      </View>

      {/* Date Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll} contentContainerStyle={styles.dateScrollContent}>
        <TouchableOpacity
          style={[styles.dateChip, !selectedDate && styles.dateChipActive]}
          onPress={() => setSelectedDate(null)}
        >
          <Text style={[styles.dateChipText, !selectedDate && styles.dateChipTextActive]}>{tr('Todos')}</Text>
        </TouchableOpacity>
        {dates.map(d => {
          const { day, date, month } = formatDateLabel(d);
          const isActive = selectedDate === d;
          return (
            <TouchableOpacity
              key={d}
              style={[styles.dateChip, isActive && styles.dateChipActive]}
              onPress={() => setSelectedDate(d)}
            >
              <Text style={[styles.dateChipDate, isActive && styles.dateChipTextActive]}>{date}</Text>
              <View style={styles.dateChipMeta}>
                <Text style={[styles.dateChipDay, isActive && styles.dateChipTextActive]}>{day}</Text>
                <Text style={[styles.dateChipMonth, isActive && styles.dateChipTextActive]}>{month}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Genre Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.genreScroll} contentContainerStyle={styles.genreScrollContent}>
        <TouchableOpacity
          style={[styles.genreChip, !selectedGenre && styles.genreChipActive]}
          onPress={() => setSelectedGenre(null)}
        >
          <Ionicons name="musical-notes" size={14} color={!selectedGenre ? COLORS.primary : COLORS.textMuted} />
          <Text style={[styles.genreChipText, !selectedGenre && styles.genreChipTextActive]}>{tr('Todos')}</Text>
        </TouchableOpacity>
        {GENRE_FILTERS.map(g => {
          const isActive = selectedGenre === g.key;
          return (
            <TouchableOpacity
              key={g.key}
              style={[styles.genreChip, isActive && { backgroundColor: `${g.color}20`, borderColor: g.color }]}
              onPress={() => setSelectedGenre(isActive ? null : g.key)}
            >
              <View style={[styles.genreDot, { backgroundColor: g.color }]} />
              <Text style={[styles.genreChipText, isActive && { color: g.color }]}>{g.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Concert List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : filteredConcerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="musical-notes-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No hay conciertos para esta fecha</Text>
          </View>
        ) : (
          filteredConcerts.map(concert => {
            const isExpanded = expanded === concert.concert_id;
            const genreColor = getGenreColor(concert.genre);
            const isPast = concert.date < todayStr;
            return (
              <TouchableOpacity
                key={concert.concert_id}
                style={[styles.concertCard, isPast && { opacity: 0.6 }]}
                onPress={() => setExpanded(isExpanded ? null : concert.concert_id)}
                activeOpacity={0.85}
              >
                {/* Image */}
                <SafeImage uri={concert.image_url} category="concert" style={styles.concertImage} />
                {isPast && (
                  <View style={styles.pastBadge}>
                    <Ionicons name="time-outline" size={11} color="#FFF" />
                    <Text style={styles.pastBadgeText}>Finalizado</Text>
                  </View>
                )}
                <View style={styles.imageOverlay} />

                {/* Price Badge */}
                {concert.is_free ? (
                  <View style={styles.freeBadge}>
                    <Text style={styles.freeBadgeText}>{tr('GRATIS')}</Text>
                  </View>
                ) : (
                  <View style={[styles.priceBadge, { backgroundColor: COLORS.primary }]}>
                    <Text style={styles.priceBadgeText}>{formatPrice(concert.price)} COP</Text>
                  </View>
                )}

                {/* Heart Button */}
                <TouchableOpacity
                  style={styles.heartBtn}
                  onPress={(e) => { e.stopPropagation(); toggleFavorite(concert.concert_id, 'concert'); }}
                >
                  <Ionicons name={isFavorite(concert.concert_id) ? 'heart' : 'heart-outline'} size={22} color={isFavorite(concert.concert_id) ? '#EF4444' : '#FFF'} />
                </TouchableOpacity>

                {/* Share Button */}
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={(e) => { e.stopPropagation(); shareConcert(concert); }}
                >
                  <Ionicons name="share-social-outline" size={20} color="#FFF" />
                </TouchableOpacity>

                {/* Content over image */}
                <View style={styles.concertOverlay}>
                  <View style={[styles.genreBadge, { backgroundColor: genreColor }]}>
                    <Text style={styles.genreText}>{concert.genre}</Text>
                  </View>
                  <Text style={styles.artistName}>{concert.artist}</Text>
                  <Text style={styles.concertTitle} numberOfLines={1}>{concert.title}</Text>
                  <View style={styles.concertMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                      <Text style={styles.metaText}>{concert.venue_name}</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
                      <Text style={styles.metaText}>{concert.start_time} - {concert.end_time}</Text>
                    </View>
                  </View>
                </View>

                {/* Expanded Details */}
                {isExpanded && (
                  <View style={styles.expandedSection}>
                    <Text style={styles.descriptionText}>{concert.description}</Text>

                    {/* Lineup */}
                    {concert.lineup && concert.lineup.length > 0 && (
                      <View style={styles.lineupSection}>
                        <Text style={styles.lineupTitle}>{tr('Lineup')}</Text>
                        {concert.lineup.map((artist, i) => (
                          <View key={i} style={styles.lineupItem}>
                            <Ionicons name="musical-note" size={14} color={genreColor} />
                            <Text style={styles.lineupText}>{artist}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Info Row */}
                    <View style={styles.infoRow}>
                      <View style={styles.infoItem}>
                        <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
                        <Text style={styles.infoText}>{formatDateLabel(concert.date).date} {formatDateLabel(concert.date).month}</Text>
                      </View>
                      <View style={styles.infoItem}>
                        <Ionicons name="people-outline" size={16} color={COLORS.textMuted} />
                        <Text style={styles.infoText}>{concert.capacity} cap.</Text>
                      </View>
                      {!concert.is_free && (
                        <View style={styles.infoItem}>
                          <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
                          <Text style={[styles.infoText, { color: COLORS.primary }]}>{formatPrice(concert.price)} COP</Text>
                        </View>
                      )}
                    </View>

                    {/* Location CTA - Opens Google Maps */}
                    <TouchableOpacity
                      style={styles.locationCta}
                      onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(concert.venue_name + ' Cartagena Colombia')}`)}
                    >
                      <Ionicons name="map" size={16} color={COLORS.primary} />
                      <Text style={styles.locationCtaText}>{concert.venue_name}</Text>
                      <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
                    </TouchableOpacity>

                    {/* Buy Ticket CTA */}
                    {concert.ticket_link ? (
                      <TouchableOpacity
                        style={[styles.ticketBtn, { backgroundColor: genreColor }]}
                        onPress={() => openTicketLink(concert.ticket_link)}
                      >
                        <Ionicons name="ticket" size={18} color="#FFF" />
                        <Text style={styles.ticketBtnText}>{tr('Comprar entrada')}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.ticketBtn, { backgroundColor: '#22C55E' }]}>
                        <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                        <Text style={styles.ticketBtnText}>{tr('Entrada libre')}</Text>
                      </View>
                    )}

                    {/* Simulate purchase (paid concerts only) */}
                    {!concert.is_free && (
                      <TouchableOpacity
                        style={styles.simPurchaseBtn}
                        onPress={() => { setPayConcert(concert); setPaySheetVisible(true); }}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="flask" size={16} color={COLORS.primary} />
                        <Text style={styles.simPurchaseText}>Simular compra</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Payment simulation sheet */}
      <PaymentSheet
        visible={paySheetVisible}
        onClose={() => setPaySheetVisible(false)}
        amount={payConcert?.price || 50000}
        currency="COP"
        meta={{ type: 'concert', concert_id: payConcert?.concert_id || '', artist: payConcert?.artist || '' }}
        title="Simular compra — Concierto"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Date filter
  dateScroll: { marginBottom: SPACING.xs, flexGrow: 0, flexShrink: 0 },
  dateScrollContent: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: 4 },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border,
    gap: 6, minWidth: 70,
  },
  dateChipActive: { backgroundColor: `${COLORS.primary}15`, borderColor: COLORS.primary },
  dateChipMeta: { alignItems: 'flex-start', justifyContent: 'center' },
  dateChipDay: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold, lineHeight: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  dateChipDate: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, lineHeight: 20 },
  dateChipMonth: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  dateChipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  dateChipTextActive: { color: COLORS.primary },

  // Genre filter
  genreScroll: { marginBottom: SPACING.sm, flexGrow: 0, flexShrink: 0 },
  genreScrollContent: { paddingHorizontal: SPACING.lg, gap: 6, paddingVertical: 4 },
  genreChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  genreChipActive: { backgroundColor: `${COLORS.primary}20`, borderColor: COLORS.primary },
  genreDot: { width: 10, height: 10, borderRadius: 5 },
  genreChipText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  genreChipTextActive: { color: COLORS.primary },

  // Concert card
  concertCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  concertImage: { width: '100%', height: 180 },
  imageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 180, backgroundColor: 'rgba(0,0,0,0.45)' },

  // Badges
  freeBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: '#22C55E', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  freeBadgeText: { fontSize: 11, color: '#FFF', ...FONTS.bold, letterSpacing: 1 },
  priceBadge: { position: 'absolute', top: 12, right: 12, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  priceBadgeText: { fontSize: 11, color: '#FFF', ...FONTS.bold },
  heartBtn: { position: 'absolute', top: 12, left: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  shareBtn: { position: 'absolute', top: 56, left: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },

  // Overlay content
  concertOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 180, padding: SPACING.md, justifyContent: 'flex-end' },
  genreBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  genreText: { fontSize: 10, color: '#FFF', ...FONTS.bold, letterSpacing: 0.5 },
  artistName: { fontSize: 22, color: '#FFF', ...FONTS.bold },
  concertTitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', ...FONTS.regular },
  concertMeta: { flexDirection: 'row', gap: SPACING.md, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', ...FONTS.medium },

  // Expanded
  expandedSection: { padding: SPACING.md, gap: SPACING.sm },
  descriptionText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 20 },
  lineupSection: { gap: 4 },
  lineupTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: 2 },
  lineupItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  lineupText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
  infoRow: { flexDirection: 'row', gap: SPACING.lg, paddingVertical: SPACING.xs },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  ticketBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: 14, borderRadius: RADIUS.full, marginTop: 4 },
  ticketBtnText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  locationCta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: `${COLORS.primary}10`, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${COLORS.primary}25` },
  locationCtaText: { flex: 1, fontSize: 13, color: COLORS.primary, ...FONTS.semibold },

  // Simulate purchase
  simPurchaseBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: 12, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: 'rgba(212,175,55,0.08)', marginTop: 4 },
  simPurchaseText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },

  // Empty
  pastBadge: { position: 'absolute', top: 12, left: 60, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, zIndex: 3 },
  pastBadgeText: { fontSize: 10, color: '#FFF', ...FONTS.bold, letterSpacing: 0.5 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: SPACING.md },
  emptyText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },
});
