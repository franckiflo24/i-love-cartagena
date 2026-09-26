import { Redirect } from 'expo-router';
// RETIRED (2026-09-26): no port-tax ticket / QR exists to show (the product was
// never sold). The dynamic route stays for the vercel.json rewrite and any old
// deep link; it lands on the official pier / park / insurance prices.
export default function PortTaxTicketRedirect() {
  return <Redirect href={'/ciudad/muelle-bodeguita' as any} />;
}
