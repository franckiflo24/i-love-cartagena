import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api } from '../constants/api';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export type WompiCheckoutResult = {
  status: 'approved' | 'declined' | 'pending' | 'error' | 'voided' | 'cancelled' | 'unknown';
  payment: any | null;
  reference: string | null;
};

/**
 * Open the Wompi hosted checkout in an in-app browser (Safari View Controller / Chrome Custom Tabs / web tab),
 * then poll the backend to determine the final status of the payment.
 *
 * @param checkoutUrl Full Wompi checkout URL returned by the backend.
 * @param reference   The payment reference we created in the backend (used to poll status).
 */
export async function openWompiCheckout(
  checkoutUrl: string,
  reference: string,
  opts?: { onStatus?: (s: string) => void; maxWaitMs?: number },
): Promise<WompiCheckoutResult> {
  const maxWaitMs = opts?.maxWaitMs ?? 90_000;

  if (Platform.OS === 'web') {
    // On web, open in a new tab. The redirect_url will land on /payments/return.
    // We can't reliably know when the user finished, so we poll for up to maxWaitMs.
    try {
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
    } catch { /* window.open blocked by popup blocker — fallback to redirect */
      window.location.href = checkoutUrl;
    }
    return await pollForFinalStatus(reference, maxWaitMs, opts?.onStatus);
  }

  // Native: use the in-app browser. The user returns to the app when they tap close.
  try {
    await WebBrowser.openBrowserAsync(checkoutUrl, {
      dismissButtonStyle: 'close',
      showTitle: true,
      enableBarCollapsing: false,
      toolbarColor: '#0B1226',
    });
  } catch (e: any) {
    return { status: 'error', payment: null, reference };
  }
  // After the browser is closed, poll for the final status
  return await pollForFinalStatus(reference, maxWaitMs, opts?.onStatus);
}

async function pollForFinalStatus(
  reference: string,
  maxWaitMs: number,
  onStatus?: (s: string) => void,
): Promise<WompiCheckoutResult> {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < maxWaitMs) {
    try {
      const p = await api.get(`/payments/by-reference/${reference}`);
      onStatus?.(p?.status || 'pending');
      if (p && p.status && p.status !== 'pending') {
        return { status: p.status, payment: p, reference };
      }
    } catch { /* payment status poll failed — will retry on next iteration */ }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 500, 4000);
  }
  // Give up — final state will arrive via webhook
  try {
    const p = await api.get(`/payments/by-reference/${reference}`);
    return { status: p?.status || 'pending', payment: p, reference };
  } catch { /* final poll failed — status will arrive via webhook */
    return { status: 'pending', payment: null, reference };
  }
}

export function describeStatus(status: string): { title: string; tone: 'success' | 'error' | 'warning' | 'info' } {
  switch (status) {
    case 'approved':
      return { title: '¡Pago aprobado!', tone: 'success' };
    case 'declined':
      return { title: 'Pago rechazado', tone: 'error' };
    case 'voided':
      return { title: 'Pago anulado', tone: 'warning' };
    case 'error':
      return { title: 'Error al procesar el pago', tone: 'error' };
    case 'pending':
      return { title: 'Pago en proceso…', tone: 'info' };
    case 'cancelled':
      return { title: 'Pago cancelado', tone: 'warning' };
    default:
      return { title: 'Estado desconocido', tone: 'warning' };
  }
}

export async function checkWompiEnabled(): Promise<{ enabled: boolean; env: string; commission_pct: number }> {
  try {
    const cfg = await api.get('/payments/config');
    return { enabled: !!cfg.enabled, env: cfg.env || 'sandbox', commission_pct: cfg.commission_pct || 3 };
  } catch { /* payments config not available — assume disabled */
    return { enabled: false, env: 'sandbox', commission_pct: 3 };
  }
}

export function notConfiguredAlert() {
  Alert.alert(
    'Pagos no configurados',
    'El equipo aún no ha conectado Wompi. Si eres administrador, agrega WOMPI_PUBLIC_KEY/PRIVATE_KEY/EVENTS_SECRET/INTEGRITY_SECRET en backend/.env y reinicia el backend.',
  );
}
