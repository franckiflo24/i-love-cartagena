import type { PaymentProvider } from './types';

/** Generates a simple unique ID without crypto.randomUUID (not available in all RN environments) */
function simpleId(): string {
  return 'xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export const MockProvider: PaymentProvider = {
  async createIntent(amount, _meta) {
    return {
      id: 'demo_' + simpleId(),
      amount,
      currency: 'COP',
      status: 'pending',
    };
  },

  async confirm(intentId, _method) {
    // Simulated processing latency
    await new Promise((r) => setTimeout(r, 1400));
    return {
      id: intentId,
      status: 'APPROVED',
      reference: 'DEMO-' + Date.now().toString(36).toUpperCase(),
      demo: true,
    };
  },

  async status(reference) {
    return {
      id: reference,
      status: 'APPROVED',
      reference,
      demo: true,
    };
  },
};
