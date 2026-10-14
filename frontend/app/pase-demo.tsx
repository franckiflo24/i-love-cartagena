// DROP D1 — /pase-demo: the money loop as a LABELED SIMULATION on the live
// domain. Unlisted (no public nav, noindex), reachable by direct URL so Phil
// can drive it or send it. Every screen carries "DEMO · Simulación"; checkout
// says "sin cargo real"; there is NO api import in this file or in demoPass —
// finishing the demo cannot write a reservation, ticket or points row. The
// REAL City Pass (Próximamente) and Rewards surfaces are untouched: this is a
// separate route built from the app's visual language, not a change to them.
import React, { useEffect, useReducer, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import Head from '../src/components/WebHead';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../src/constants/theme';
import { useTr } from '../src/i18n/autoTr';
import {
  DEMO_TIERS, DEMO_PERKS, DEMO_METHODS, ISLAND_SPLIT, islandTotal, WELCOME_PTS, REDEEM_PTS, GOAL_PTS,
  initialDemoState, demoPoints, fmtCop, type DemoState, type DemoStep,
} from '../src/lib/demoPass';

type Action =
  | { type: 'goto'; step: DemoStep }
  | { type: 'pick_tier'; id: string }
  | { type: 'pick_method'; m: DemoState['method'] }
  | { type: 'pay_start' } | { type: 'pay_done' }
  | { type: 'open_redeem'; id: string }
  | { type: 'confirm_redeem' }
  | { type: 'pay_island' }
  | { type: 'reset' };

function reducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case 'goto': return { ...s, step: a.step };
    case 'pick_tier': return { ...s, tier: DEMO_TIERS.find((t) => t.id === a.id) || null, step: 'checkout' };
    case 'pick_method': return { ...s, method: a.m };
    case 'pay_start': return { ...s, paying: true };
    case 'pay_done': return { ...s, paying: false, step: 'active' };
    case 'open_redeem': return { ...s, redeemingId: a.id, step: 'redeem' };
    case 'confirm_redeem':
      return s.redeemingId && !s.redeemed.includes(s.redeemingId)
        ? { ...s, redeemed: [...s.redeemed, s.redeemingId], redeemingId: null, step: 'perks' }
        : { ...s, redeemingId: null, step: 'perks' };
    case 'pay_island':
      return { ...s, islandPaid: true, step: 'credencial' };
    case 'reset': return initialDemoState();
    default: return s;
  }
}

const STEP_NO: Record<DemoStep, number> = {
  intro: 1, checkout: 2, active: 3, perks: 4, redeem: 5, rewards: 6,
  oficial: 7, split: 8, credencial: 9, business: 10, ciudad: 11,
};
const STEPS_TOTAL = 11;
const QR_ROTATE_S = 12; // mirrors the rotating door-QR cadence, demo payload only

export default function PaseDemo() {
  const tr = useTr();
  const router = useRouter();
  const [st, dispatch] = useReducer(reducer, undefined, initialDemoState);
  const [qrTick, setQrTick] = useState(0);
  const [qrLeft, setQrLeft] = useState(QR_ROTATE_S);

  // Rotating demo QR: a fresh payload every QR_ROTATE_S seconds, like the real
  // door code — but the payload is self-describing demo data, never a ticket.
  useEffect(() => {
    if (st.step !== 'redeem' && st.step !== 'credencial') return;
    setQrLeft(QR_ROTATE_S);
    const t = setInterval(() => {
      setQrLeft((v) => {
        if (v <= 1) { setQrTick((k) => k + 1); return QR_ROTATE_S; }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [st.step, st.redeemingId]);

  const exit = () => router.replace('/(tabs)' as never);
  const pts = demoPoints(st);
  const perk = DEMO_PERKS.find((p) => p.id === st.redeemingId) || null;

  const Seal = () => (
    <View style={sty.seal}>
      <Ionicons name="shield-checkmark" size={12} color={COLORS.primary} />
      <Text style={sty.sealText}>{tr('Verificado por AMO')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={sty.container} edges={['top']}>
      <Head>
        <title>AMO · Demo del Pase</title>
        {/* Unlisted: never indexed, never in public nav */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {/* ── Persistent demo chrome: marker + exit, on EVERY step ── */}
      <View style={sty.demoBar}>
        <View style={sty.demoBadge}>
          <Ionicons name="flask-outline" size={13} color="#0B0E14" />
          <Text style={sty.demoBadgeText}>{tr('DEMO · Simulación')}</Text>
        </View>
        <Text style={sty.demoBarHint}>{tr('Propuesta AMO — sin cargos reales')}</Text>
        <TouchableOpacity onPress={exit} style={sty.exitBtn} accessibilityRole="button" testID="demo-exit">
          <Ionicons name="arrow-back" size={14} color={COLORS.textMain} />
          <Text style={sty.exitText}>{tr('Volver a la app')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={sty.body} testID={`demo-step-${st.step}`}>
        <Text style={sty.stepNo}>{tr('Paso')} {STEP_NO[st.step]}/{STEPS_TOTAL}</Text>

        {/* ── 1 · Intro + tiers ── */}
        {st.step === 'intro' && (
          <View>
            <Text style={sty.h1}>{tr('El Pase AMO')}</Text>
            <Text style={sty.lead}>
              {tr('Así funciona el circuito completo: activas el Pase, usas beneficios en lugares verificados, ganas puntos — y el negocio ve llegar ese tráfico.')}
            </Text>
            {DEMO_TIERS.map((t) => (
              <TouchableOpacity key={t.id} style={[sty.tierCard, t.popular && sty.tierCardPop]}
                onPress={() => dispatch({ type: 'pick_tier', id: t.id })} activeOpacity={0.85} testID={`demo-tier-${t.id}`}>
                {t.popular && <Text style={sty.popTag}>{tr('Popular')}</Text>}
                <View style={sty.tierRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={sty.tierName}>{tr(t.name)}</Text>
                    <Text style={sty.tierDays}>{tr(t.days)}</Text>
                  </View>
                  <Text style={sty.tierPrice}>${t.price}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── 2 · Simulated checkout ── */}
        {st.step === 'checkout' && st.tier && (
          <View>
            <Text style={sty.h1}>{tr('Activar')} · {tr(st.tier.name)}</Text>
            <View style={sty.sumRow}>
              <Text style={sty.sumLabel}>{tr('Total')}</Text>
              <Text style={sty.sumPrice}>${st.tier.price} USD</Text>
            </View>
            <Text style={sty.noCharge}>
              <Ionicons name="information-circle-outline" size={13} color={COLORS.mustard} />{' '}
              {tr('Sin cargo real — este pago es una simulación de demostración.')}
            </Text>
            <Text style={sty.sectionLabel}>{tr('Método de pago')}</Text>
            <View style={sty.chipsWrap}>
              {DEMO_METHODS.map((m) => (
                <TouchableOpacity key={m} style={[sty.chip, st.method === m && sty.chipOn]}
                  onPress={() => dispatch({ type: 'pick_method', m })} activeOpacity={0.8} testID={`demo-method-${m}`}>
                  <Text style={[sty.chipText, st.method === m && sty.chipTextOn]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[sty.cta, (!st.method || st.paying) && sty.ctaOff]}
              disabled={!st.method || st.paying}
              onPress={() => { dispatch({ type: 'pay_start' }); setTimeout(() => dispatch({ type: 'pay_done' }), 1100); }}
              activeOpacity={0.85} testID="demo-pay">
              {st.paying ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={sty.ctaText}>{tr('Pagar (demo)')} · ${st.tier.price}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => dispatch({ type: 'goto', step: 'intro' })}>
              <Text style={sty.backLink}>{tr('Cambiar plan')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 3 · Pass active + wallet card ── */}
        {st.step === 'active' && st.tier && (
          <View>
            <View style={sty.okRow}>
              <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
              <Text style={sty.h2}>{tr('Pase activo')}</Text>
            </View>
            <LinearGradient colors={['#0E4F49', '#12B5A5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.passCard}>
              <View style={sty.passTop}>
                <Text style={sty.passBrand}>AMO · {tr('PASE')}</Text>
                <Text style={sty.passDemoTag}>{tr('DEMO')}</Text>
              </View>
              <Text style={sty.passTier}>{tr(st.tier.name)}</Text>
              <Text style={sty.passHolder}>{tr('Titular')}: {tr('Invitado de demostración')}</Text>
              <Text style={sty.passValid}>{tr(st.tier.days)}</Text>
            </LinearGradient>
            <View style={sty.ptsToast} testID="demo-welcome-pts">
              <Ionicons name="sparkles" size={14} color={COLORS.mustard} />
              <Text style={sty.ptsToastText}>+{WELCOME_PTS} {tr('pts de bienvenida')}</Text>
            </View>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'perks' })} activeOpacity={0.85} testID="demo-to-perks">
              <Text style={sty.ctaText}>{tr('Ver beneficios verificados')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 4 · Verified perks ── */}
        {st.step === 'perks' && (
          <View>
            <Text style={sty.h1}>{tr('Beneficios en lugares verificados')}</Text>
            <Text style={sty.lead}>{tr('Cada beneficio vive en un negocio con el sello — la verificación no se compra.')}</Text>
            {DEMO_PERKS.map((p) => {
              const done = st.redeemed.includes(p.id);
              return (
                <View key={p.id} style={sty.perkCard}>
                  <View style={sty.perkIconWrap}><Ionicons name={p.icon as never} size={18} color={COLORS.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <View style={sty.perkHead}>
                      <Text style={sty.perkPartner}>{p.partner}</Text>
                      <Seal />
                    </View>
                    <Text style={sty.perkText}>{tr(p.perk)}</Text>
                  </View>
                  {done ? (
                    <Text style={sty.perkDone}>✓ {tr('Canjeado')} · +{REDEEM_PTS}</Text>
                  ) : (
                    <TouchableOpacity style={sty.perkBtn} onPress={() => dispatch({ type: 'open_redeem', id: p.id })} activeOpacity={0.85} testID={`demo-redeem-${p.id}`}>
                      <Text style={sty.perkBtnText}>{tr('Canjear')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {st.redeemed.length > 0 && (
              <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'rewards' })} activeOpacity={0.85} testID="demo-to-rewards">
                <Text style={sty.ctaText}>{tr('Ver mis puntos')} · {pts} pts</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 5 · Redeem: rotating demo QR ── */}
        {st.step === 'redeem' && perk && (
          <View>
            <Text style={sty.h1}>{perk.partner}</Text>
            <Text style={sty.lead}>{tr(perk.perk)}</Text>
            <View style={sty.qrBox}>
              <QRCode value={`AMO-DEMO-${perk.id}-${qrTick}`} size={180} backgroundColor="#FFFFFF" color="#0B0E14" />
              <View style={sty.qrBarTrack}><View style={[sty.qrBarFill, { width: `${(qrLeft / QR_ROTATE_S) * 100}%` }]} /></View>
              <Text style={sty.qrHint}>{tr('El código rota cada 12 s, como en la puerta real')}</Text>
            </View>
            <Text style={sty.noCharge}>{tr('Muestra este código en el local — en esta demo, tú haces de staff.')}</Text>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'confirm_redeem' })} activeOpacity={0.85} testID="demo-confirm-redeem">
              <Text style={sty.ctaText}>{tr('Simular canje en el local')} · +{REDEEM_PTS} pts</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => dispatch({ type: 'goto', step: 'perks' })}>
              <Text style={sty.backLink}>{tr('Volver a beneficios')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 6 · Rewards wallet ── */}
        {st.step === 'rewards' && (
          <View>
            <Text style={sty.h1}>{tr('Mis puntos')}</Text>
            <View style={sty.balCard}>
              <Text style={sty.balNum} testID="demo-balance">{pts}</Text>
              <Text style={sty.balPts}>pts</Text>
              <View style={sty.qrBarTrack}>
                <View style={[sty.qrBarFill, { width: `${Math.min(100, (pts / GOAL_PTS) * 100)}%`, backgroundColor: COLORS.mustard }]} />
              </View>
              <Text style={sty.balGoal}>
                {pts >= GOAL_PTS ? tr('¡Crédito desbloqueado!') : `${GOAL_PTS - pts} ${tr('pts para')} $5 ${tr('de crédito AMO')}`}
              </Text>
            </View>
            <Text style={sty.sectionLabel}>{tr('Historial')}</Text>
            <View style={sty.histRow}>
              <Text style={sty.histLabel}>{tr('Bienvenida al Pase')}</Text>
              <Text style={sty.histPts}>+{WELCOME_PTS}</Text>
            </View>
            {st.redeemed.map((id) => {
              const p = DEMO_PERKS.find((x) => x.id === id);
              return (
                <View key={id} style={sty.histRow}>
                  <Text style={sty.histLabel}>{tr('Canje')} · {p?.partner}</Text>
                  <Text style={sty.histPts}>+{REDEEM_PTS}</Text>
                </View>
              );
            })}
            <Text style={sty.honesty}>
              {tr('Los puntos se ganan por usar, visitar y reseñar — nunca por reseñas positivas.')}
            </Text>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'oficial' })} activeOpacity={0.85} testID="demo-to-oficial">
              <Text style={sty.ctaText}>{tr('Pagar servicios oficiales')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 7 · Pagos oficiales: the Island Day bundle (PROPOSAL) ── */}
        {st.step === 'oficial' && (
          <View>
            <Text style={sty.propTag}>{tr('Propuesta AMO — ninguna entidad ha adoptado este canal todavía')}</Text>
            <Text style={sty.h1}>{tr('Pase Isla · Island Day')}</Text>
            <Text style={sty.lead}>
              {tr('Las tarifas obligatorias del día de islas, cobradas una sola vez en el app: el pago se divide automáticamente a cada entidad; AMO cobra solo su tarifa de servicio.')}
            </Text>
            {ISLAND_SPLIT.map((l) => (
              <View key={l.id} style={sty.perkCard}>
                <View style={sty.perkIconWrap}><Ionicons name={l.icon as never} size={18} color={l.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={sty.perkPartner}>{tr(l.name)}</Text>
                  <Text style={sty.perkText}>{tr(l.entity)}</Text>
                </View>
                <Text style={sty.histPts}>{fmtCop(l.amountCop)}</Text>
              </View>
            ))}
            <View style={sty.sumRow}>
              <Text style={sty.sumLabel}>{tr('Total del día')}</Text>
              <Text style={sty.sumPrice} testID="demo-island-total">{fmtCop(islandTotal())}</Text>
            </View>
            <Text style={sty.noCharge}>{tr('Tarifas de ejemplo — las define el convenio. Sin cargo real; aquí no se recauda nada.')}</Text>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'split' })} activeOpacity={0.85} testID="demo-to-split">
              <Text style={sty.ctaText}>{tr('Pagar Pase Isla (demo)')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => dispatch({ type: 'goto', step: 'business' })} testID="demo-skip-island">
              <Text style={sty.backLink}>{tr('Saltar al lado del negocio')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 8 · THE HERO: the split — every entity gets paid, visibly ── */}
        {st.step === 'split' && (
          <View>
            <Text style={sty.propTag}>{tr('Propuesta AMO — ninguna entidad ha adoptado este canal todavía')}</Text>
            <Text style={sty.h1}>{tr('Un pago, cada entidad cobra lo suyo')}</Text>
            <View style={sty.splitBar}>
              {ISLAND_SPLIT.map((l) => (
                <View key={l.id} style={{ flex: l.amountCop, backgroundColor: l.color }} />
              ))}
            </View>
            {ISLAND_SPLIT.map((l) => {
              const pct = Math.round((l.amountCop / islandTotal()) * 100);
              return (
                <View key={l.id} style={sty.histRow}>
                  <View style={[sty.dot, { backgroundColor: l.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={sty.histLabel}>{tr(l.entity)}</Text>
                    <Text style={sty.perkText}>{tr(l.name)}</Text>
                  </View>
                  <Text style={sty.histPts}>{fmtCop(l.amountCop)} · {pct}%</Text>
                </View>
              );
            })}
            <Text style={sty.honesty}>
              {tr('El pago se divide automáticamente a cada entidad; AMO cobra solo su tarifa de servicio.')} {st.method ? `${st.method} · ` : ''}{tr('Sin cargo real')}.
            </Text>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'pay_island' })} activeOpacity={0.85} testID="demo-pay-island">
              <Text style={sty.ctaText}>{tr('Confirmar (demo)')} · {fmtCop(islandTotal())}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 9 · One credential clears the whole day ── */}
        {st.step === 'credencial' && (
          <View>
            <Text style={sty.propTag}>{tr('Propuesta AMO — ninguna entidad ha adoptado este canal todavía')}</Text>
            <Text style={sty.h1}>{tr('Credencial del día')}</Text>
            <Text style={sty.lead}>{tr('Un solo QR verificado para los cuatro controles del día — muelle, parque, seguro y lancha.')}</Text>
            <View style={sty.qrBox}>
              <QRCode value={`AMO-DEMO-ISLA-${qrTick}`} size={180} backgroundColor="#FFFFFF" color="#0B0E14" />
              <View style={sty.qrBarTrack}><View style={[sty.qrBarFill, { width: `${(qrLeft / QR_ROTATE_S) * 100}%` }]} /></View>
              <Text style={sty.qrHint}>{tr('El código rota cada 12 s, como en la puerta real')}</Text>
            </View>
            {ISLAND_SPLIT.filter((l) => l.clears).map((l) => (
              <View key={l.id} style={sty.histRow}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                <Text style={[sty.histLabel, { flex: 1, marginLeft: 8 }]}>{tr(l.clears)}</Text>
                <Text style={sty.folio}>{tr('aceptado (demo)')}</Text>
              </View>
            ))}
            <Text style={sty.folio}>{tr('Recibo oficial (demo)')} · AMO-ISLA-001</Text>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'business' })} activeOpacity={0.85} testID="demo-to-business">
              <Text style={sty.ctaText}>{tr('Ver el lado del negocio')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 7 · Business view ── */}
        {st.step === 'business' && (
          <View>
            <Text style={sty.h1}>{tr('Panel del negocio')}</Text>
            <View style={sty.bizCard}>
              <View style={sty.perkHead}>
                <Text style={sty.bizName}>Nueva Lengua</Text>
                <Seal />
              </View>
              <Text style={sty.bizVia}>{tr('Verificado vía RUES + Cámara de Comercio — el sello no se compra.')}</Text>
              <View style={sty.bizPerkRow}>
                <Ionicons name="pricetag-outline" size={14} color={COLORS.textMuted} />
                <Text style={sty.bizPerk}>{tr('15% en el curso semanal de español')}</Text>
              </View>
              <Text style={sty.sectionLabel}>{tr('Tráfico del Pase (datos de demostración)')}</Text>
              <View style={sty.statRow}>
                <View style={sty.stat}><Text style={sty.statNum}>38</Text><Text style={sty.statLbl}>{tr('Visitas')}</Text></View>
                <View style={sty.stat}><Text style={sty.statNum}>12</Text><Text style={sty.statLbl}>{tr('Canjes')}</Text></View>
                <View style={sty.stat}><Text style={sty.statNum}>5</Text><Text style={sty.statLbl}>{tr('Reseñas')}</Text></View>
              </View>
            </View>
            <View style={sty.sponsorBox}>
              <Text style={sty.sponsorKicker}>{tr('Patrocinado')}</Text>
              <Text style={sty.sponsorText}>
                {tr('Espacio pagado y siempre etiquetado — no compra el sello ni cambia el orden del ranking.')}
              </Text>
            </View>
            <TouchableOpacity style={sty.cta} onPress={() => dispatch({ type: 'goto', step: 'ciudad' })} activeOpacity={0.85} testID="demo-to-ciudad">
              <Text style={sty.ctaText}>{tr('Ver lo que recauda la ciudad')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 11 · The Alcaldía slide: what the city collects, visibly ── */}
        {st.step === 'ciudad' && (
          <View>
            <Text style={sty.propTag}>{tr('Propuesta AMO — ninguna entidad ha adoptado este canal todavía')}</Text>
            <Text style={sty.h1}>{tr('Lo que recauda la ciudad')}</Text>
            <Text style={sty.lead}>
              {tr('Cada pago trazable por folio y dividido en origen: el efectivo sin registro deja de fugarse. AMO es el canal, no el recaudador final.')}
            </Text>
            <View style={sty.bizCard}>
              <Text style={sty.sectionLabel}>{tr('Hoy (datos de demostración)')}</Text>
              <View style={sty.statRow}>
                <View style={sty.stat}><Text style={sty.statNum}>$18,4M</Text><Text style={sty.statLbl}>{tr('Recaudado')} COP</Text></View>
                <View style={sty.stat}><Text style={sty.statNum}>1.167</Text><Text style={sty.statLbl}>{tr('Turistas')}</Text></View>
                <View style={sty.stat}><Text style={sty.statNum}>86%</Text><Text style={sty.statLbl}>{tr('Digital')}</Text></View>
              </View>
              <Text style={sty.perkText}>{tr('86% digital vs 14% efectivo — cada punto digital es recaudo que antes se perdía sin registro.')}</Text>
            </View>
            <View style={sty.bizCard}>
              <Text style={sty.sectionLabel}>{tr('Desglose por entidad (demo)')}</Text>
              {ISLAND_SPLIT.map((l) => {
                const pct = Math.round((l.amountCop / islandTotal()) * 100);
                return (
                  <View key={l.id} style={sty.histRow}>
                    <View style={[sty.dot, { backgroundColor: l.color }]} />
                    <Text style={[sty.histLabel, { flex: 1 }]}>{tr(l.entity)}</Text>
                    <Text style={sty.histPts}>{pct}%</Text>
                  </View>
                );
              })}
              {st.islandPaid && (
                <Text style={sty.folio}>{tr('Incluye tu Pase Isla de esta sesión')} · AMO-ISLA-001 · {fmtCop(islandTotal())}</Text>
              )}
            </View>
            <Text style={sty.honesty}>
              {tr('Tarifas de ejemplo — las define el convenio. Alineado con la visión de ciudad: recaudo oficial transparente. AMO es una empresa privada — el canal tecnológico, nunca la entidad.')}
            </Text>
            <TouchableOpacity style={sty.cta} onPress={exit} activeOpacity={0.85} testID="demo-finish">
              <Text style={sty.ctaText}>{tr('Terminar demo · volver a la app')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => dispatch({ type: 'reset' })}>
              <Text style={sty.backLink}>{tr('Reiniciar demo')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const sty = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  demoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    backgroundColor: 'rgba(233,185,73,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(233,185,73,0.35)',
  },
  demoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.mustard, borderRadius: RADIUS.sm, paddingHorizontal: 7, paddingVertical: 3,
  },
  demoBadgeText: { fontSize: 11, color: '#0B0E14', ...FONTS.bold, letterSpacing: 0.4 },
  demoBarHint: { flex: 1, fontSize: 11, color: COLORS.mustard, ...FONTS.semibold },
  exitBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  exitText: { fontSize: 12, color: COLORS.textMain, ...FONTS.semibold },
  body: { padding: SPACING.lg, paddingBottom: 60, maxWidth: 560, width: '100%', alignSelf: 'center' },
  stepNo: { fontSize: 11, color: COLORS.textMuted, marginBottom: 6, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  h1: { ...TYPE.title1, color: COLORS.textMain, marginBottom: 6 },
  h2: { ...TYPE.title3, color: COLORS.textMain },
  lead: { fontSize: 13.5, lineHeight: 20, color: COLORS.textMuted, marginBottom: SPACING.md },
  tierCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  tierCardPop: { borderColor: COLORS.primary },
  popTag: { alignSelf: 'flex-start', fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 4 },
  tierRow: { flexDirection: 'row', alignItems: 'center' },
  tierName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  tierDays: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  tierPrice: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm },
  sumLabel: { fontSize: 14, color: COLORS.textMuted },
  sumPrice: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  noCharge: { fontSize: 12.5, lineHeight: 18, color: COLORS.mustard, marginBottom: SPACING.md },
  sectionLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginTop: SPACING.sm, marginBottom: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md },
  chip: { borderWidth: 1, borderColor: COLORS.hairline, backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: COLORS.primary, backgroundColor: 'rgba(18,181,165,0.12)' },
  chipText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextOn: { color: COLORS.primary },
  cta: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 13, marginTop: SPACING.sm,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { fontSize: 14.5, color: '#FFF', ...FONTS.bold },
  backLink: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 12, textDecorationLine: 'underline' as const },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.md },
  passCard: { borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.sm },
  passTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  passBrand: { fontSize: 12, color: 'rgba(255,255,255,0.85)', ...FONTS.bold, letterSpacing: 1.2 },
  passDemoTag: { fontSize: 10, color: '#0B0E14', backgroundColor: COLORS.mustard, ...FONTS.bold, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' as const },
  passTier: { fontSize: 24, color: '#FFF', ...FONTS.bold, marginTop: 14 },
  passHolder: { fontSize: 12.5, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
  passValid: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  ptsToast: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(233,185,73,0.12)', borderWidth: 1, borderColor: 'rgba(233,185,73,0.4)',
    borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, marginBottom: SPACING.sm,
  },
  ptsToastText: { fontSize: 13, color: COLORS.mustard, ...FONTS.bold },
  perkCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  perkIconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(18,181,165,0.1)', alignItems: 'center', justifyContent: 'center' },
  perkHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  perkPartner: { fontSize: 14.5, color: COLORS.textMain, ...FONTS.bold },
  perkText: { fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 },
  perkBtn: { borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6 },
  perkBtnText: { fontSize: 12.5, color: COLORS.primary, ...FONTS.bold },
  perkDone: { fontSize: 11.5, color: COLORS.primary, ...FONTS.semibold, maxWidth: 90, textAlign: 'right' as const },
  seal: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(18,181,165,0.1)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
  },
  sealText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  qrBox: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.sm },
  qrBarTrack: { height: 4, alignSelf: 'stretch', backgroundColor: 'rgba(11,14,20,0.12)', borderRadius: 2, marginTop: 12, overflow: 'hidden' as const },
  qrBarFill: { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  qrHint: { fontSize: 11, color: '#4A5264', marginTop: 8 },
  balCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
    padding: SPACING.lg, alignItems: 'center', marginBottom: SPACING.md,
  },
  balNum: { fontSize: 42, color: COLORS.textMain, ...FONTS.bold },
  balPts: { fontSize: 13, color: COLORS.textMuted, marginBottom: 8 },
  balGoal: { fontSize: 12.5, color: COLORS.mustard, ...FONTS.semibold, marginTop: 8 },
  folio: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, marginTop: 3 },
  propTag: {
    fontSize: 10.5, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 0.4,
    textTransform: 'uppercase' as const, marginBottom: 8,
  },
  splitBar: {
    flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' as const,
    marginBottom: SPACING.md, marginTop: SPACING.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  histRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.hairline,
  },
  histLabel: { fontSize: 13, color: COLORS.textMain },
  histPts: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  honesty: { fontSize: 12, lineHeight: 18, color: COLORS.textMuted, fontStyle: 'italic' as const, marginTop: SPACING.md, marginBottom: SPACING.sm },
  bizCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  bizName: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold },
  bizVia: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, marginBottom: 8 },
  bizPerkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bizPerk: { fontSize: 13, color: COLORS.textMain },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  statNum: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  statLbl: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  sponsorBox: {
    borderWidth: 1, borderColor: 'rgba(233,185,73,0.45)', borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(233,185,73,0.07)', padding: SPACING.md, marginBottom: SPACING.sm,
  },
  sponsorKicker: { fontSize: 10.5, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 4 },
  sponsorText: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMain },
});
