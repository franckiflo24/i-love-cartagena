export type PayMode = 'mock' | 'wompi' | 'pse';

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: 'COP';
  status: 'pending';
}

export interface PaymentResult {
  id: string;
  status: 'APPROVED' | 'DECLINED' | 'ERROR';
  reference: string;
  demo: boolean;
}

export interface PaymentProvider {
  createIntent(amount: number, meta: Record<string, unknown>): Promise<PaymentIntent>;
  confirm(intentId: string, method: 'card' | 'pse' | 'nequi'): Promise<PaymentResult>;
  status(reference: string): Promise<PaymentResult>;
}
