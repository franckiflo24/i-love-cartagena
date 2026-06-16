import type { PayMode, PaymentProvider } from './types';
import { MockProvider } from './mock';

export type { PayMode, PaymentIntent, PaymentResult, PaymentProvider } from './types';

const MODE = (process.env.EXPO_PUBLIC_PAYMENTS_MODE ?? 'mock') as PayMode;

// When real providers are implemented, they will be imported and selected here.
// For now, only MockProvider exists.
export const payments: PaymentProvider =
  // MODE === 'wompi' ? WompiProvider :
  // MODE === 'pse'   ? PSEProvider   :
  MockProvider;
