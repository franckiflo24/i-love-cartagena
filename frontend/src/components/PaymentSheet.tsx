import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, ELEVATION } from '../constants/theme';
import { payments } from '../lib/payments';
import type { PaymentResult } from '../lib/payments';

type PaymentMethod = 'card' | 'pse' | 'nequi';

type Step = 'method-select' | 'summary' | 'processing' | 'result';

interface PaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  amount: number;
  currency?: 'COP';
  meta?: Record<string, unknown>;
  onSuccess?: (result: PaymentResult) => void;
  title?: string;
}

const METHOD_OPTIONS: { key: PaymentMethod; label: string; icon: string; desc: string }[] = [
  { key: 'card', label: 'Tarjeta', icon: 'card', desc: '4242 4242 4242 4242' },
  { key: 'pse', label: 'PSE', icon: 'globe', desc: 'Débito bancario' },
  { key: 'nequi', label: 'Nequi', icon: 'phone-portrait', desc: 'Pago móvil' },
];

function formatCOP(amount: number): string {
  return '$' + amount.toLocaleString('es-CO') + ' COP';
}

export default function PaymentSheet({
  visible,
  onClose,
  amount,
  currency = 'COP',
  meta = {},
  onSuccess,
  title = 'Pago',
}: PaymentSheetProps) {
  const [step, setStep] = useState<Step>('method-select');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('method-select');
    setMethod(null);
    setResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleSelectMethod = useCallback((m: PaymentMethod) => {
    setMethod(m);
    setStep('summary');
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!method) return;
    setStep('processing');
    setError(null);
    try {
      const intent = await payments.createIntent(amount, meta);
      const payResult = await payments.confirm(intent.id, method);

      if (payResult.status === 'APPROVED') {
        setResult(payResult);
        setStep('result');
        onSuccess?.(payResult);
      } else if (payResult.status === 'DECLINED') {
        setError('Pago rechazado. Intenta con otro método.');
        setStep('summary');
      } else {
        setError('Error al procesar el pago. Intenta de nuevo.');
        setStep('summary');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      console.error('[PaymentSheet]', msg);
      setError('Error al procesar el pago. Intenta de nuevo.');
      setStep('summary');
    }
  }, [method, amount, meta, onSuccess]);

  // Demo badge — always visible inside PaymentSheet when in mock mode
  const DemoBadge = () => (
    <View style={styles.demoBadge}>
      <Ionicons name="information-circle" size={14} color="#F59E0B" />
      <Text style={styles.demoBadgeText}>
        Modo demostración — no se realiza ningún cobro real.
      </Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>{title}</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={COLORS.textMain} />
              </TouchableOpacity>
            </View>
          </View>

          {/* REQUIRED: Demo badge always visible */}
          <DemoBadge />

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ── Step: method-select ── */}
            {step === 'method-select' && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>Selecciona método de pago</Text>
                <Text style={styles.amountDisplay}>{formatCOP(amount)}</Text>
                <View style={styles.methodList}>
                  {METHOD_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      style={styles.methodCard}
                      onPress={() => handleSelectMethod(opt.key)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.methodIcon}>
                        <Ionicons name={opt.icon as any} size={22} color={COLORS.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.methodLabel}>{opt.label}</Text>
                        <Text style={styles.methodDesc}>{opt.desc}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* ── Step: summary ── */}
            {step === 'summary' && method && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>Resumen del pago</Text>

                {/* Card preview for card method */}
                {method === 'card' && (
                  <View style={styles.cardPreview}>
                    <View style={styles.cardPreviewHeader}>
                      <Ionicons name="card" size={20} color={COLORS.primary} />
                      <Text style={styles.cardPreviewLabel}>Tarjeta de demostración</Text>
                    </View>
                    <Text style={styles.cardNumber}>4242  4242  4242  4242</Text>
                    <View style={styles.cardRow}>
                      <Text style={styles.cardDetail}>DEMO/USER</Text>
                      <Text style={styles.cardDetail}>12/29</Text>
                      <Text style={styles.cardDetail}>CVV ***</Text>
                    </View>
                  </View>
                )}

                {method === 'pse' && (
                  <View style={styles.cardPreview}>
                    <View style={styles.cardPreviewHeader}>
                      <Ionicons name="globe" size={20} color={COLORS.primary} />
                      <Text style={styles.cardPreviewLabel}>PSE — Débito bancario</Text>
                    </View>
                    <Text style={styles.cardDetail}>Banco simulado · Sin datos reales</Text>
                  </View>
                )}

                {method === 'nequi' && (
                  <View style={styles.cardPreview}>
                    <View style={styles.cardPreviewHeader}>
                      <Ionicons name="phone-portrait" size={20} color={COLORS.primary} />
                      <Text style={styles.cardPreviewLabel}>Nequi — Pago móvil</Text>
                    </View>
                    <Text style={styles.cardDetail}>Número simulado · Sin datos reales</Text>
                  </View>
                )}

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total</Text>
                  <Text style={styles.summaryValue}>{formatCOP(amount)}</Text>
                </View>

                {error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.error} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => { setStep('method-select'); setError(null); }}
                  >
                    <Ionicons name="arrow-back" size={18} color={COLORS.textMain} />
                    <Text style={styles.backButtonText}>Atrás</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmButton}
                    onPress={handleConfirm}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="lock-closed" size={16} color={COLORS.white} />
                    <Text style={styles.confirmButtonText}>Simular pago</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Step: processing ── */}
            {step === 'processing' && (
              <View style={styles.processingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.processingText}>Procesando pago simulado...</Text>
                <Text style={styles.processingSubtext}>No se realizará ningún cobro real</Text>
              </View>
            )}

            {/* ── Step: result (only reachable after APPROVED) ── */}
            {step === 'result' && result && result.status === 'APPROVED' && (
              <View style={styles.resultContainer}>
                <View style={styles.resultIconWrap}>
                  <Ionicons name="checkmark-circle" size={56} color={COLORS.primary} />
                </View>

                {result.demo ? (
                  <>
                    <Text style={styles.resultTitle}>Reserva simulada</Text>
                    <Text style={styles.resultSubtitle}>Pago de demostración</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.resultTitle}>Pago aprobado</Text>
                  </>
                )}

                <View style={styles.resultDetails}>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Referencia</Text>
                    <Text style={styles.resultValue}>{result.reference}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Monto</Text>
                    <Text style={styles.resultValue}>{formatCOP(amount)}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Estado</Text>
                    <Text style={[styles.resultValue, { color: COLORS.primary }]}>APROBADO</Text>
                  </View>
                </View>

                {/* DEMO receipt watermark */}
                {result.demo && (
                  <View style={styles.demoReceipt}>
                    <Text style={styles.demoWatermark}>DEMO</Text>
                    <Text style={styles.demoReceiptText}>
                      No v{'\u00e1'}lido para abordaje/ingreso
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.doneButton}
                  onPress={handleClose}
                  activeOpacity={0.85}
                >
                  <Text style={styles.doneButtonText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '90%',
    ...ELEVATION.sheet,
  },
  header: {
    alignItems: 'center',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textFaint,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    fontSize: 18,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Demo badge — REQUIRED, always visible
  demoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  demoBadgeText: {
    flex: 1,
    fontSize: 12,
    color: '#F59E0B',
    ...FONTS.semibold,
  },

  body: {
    paddingHorizontal: SPACING.lg,
  },

  // Step containers
  stepContainer: {
    paddingVertical: SPACING.lg,
  },
  stepTitle: {
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.bold,
    marginBottom: SPACING.md,
  },
  amountDisplay: {
    fontSize: 28,
    color: COLORS.primary,
    ...FONTS.bold,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },

  // Method cards
  methodList: {
    gap: SPACING.sm,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodLabel: {
    fontSize: 15,
    color: COLORS.textMain,
    ...FONTS.semibold,
  },
  methodDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },

  // Card preview
  cardPreview: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  cardPreviewLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.semibold,
  },
  cardNumber: {
    fontSize: 20,
    color: COLORS.textMain,
    ...FONTS.bold,
    letterSpacing: 2,
    marginBottom: SPACING.sm,
  },
  cardRow: {
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  cardDetail: {
    fontSize: 11,
    color: COLORS.textMuted,
    ...FONTS.medium,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.sm,
  },
  summaryLabel: {
    fontSize: 16,
    color: COLORS.textMuted,
    ...FONTS.semibold,
  },
  summaryValue: {
    fontSize: 20,
    color: COLORS.primary,
    ...FONTS.bold,
  },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.error,
    ...FONTS.medium,
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  backButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: 14,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backButtonText: {
    fontSize: 14,
    color: COLORS.textMain,
    ...FONTS.semibold,
  },
  confirmButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: 14,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  confirmButtonText: {
    fontSize: 15,
    color: COLORS.white,
    ...FONTS.bold,
  },

  // Processing
  processingContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.md,
  },
  processingText: {
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.semibold,
  },
  processingSubtext: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },

  // Result
  resultContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    gap: SPACING.md,
  },
  resultIconWrap: {
    marginBottom: SPACING.sm,
  },
  resultTitle: {
    fontSize: 22,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  resultSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },
  resultDetails: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resultLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.medium,
  },
  resultValue: {
    fontSize: 13,
    color: COLORS.textMain,
    ...FONTS.bold,
  },

  // Demo receipt / watermark
  demoReceipt: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    marginTop: SPACING.sm,
    borderWidth: 2,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderStyle: 'dashed',
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
  },
  demoWatermark: {
    fontSize: 36,
    color: 'rgba(245, 158, 11, 0.35)',
    ...FONTS.bold,
    letterSpacing: 8,
  },
  demoReceiptText: {
    fontSize: 12,
    color: '#F59E0B',
    ...FONTS.semibold,
    marginTop: SPACING.xs,
  },

  doneButton: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  doneButtonText: {
    fontSize: 15,
    color: COLORS.textMain,
    ...FONTS.semibold,
  },
});
