import { Redirect } from 'expo-router';
// RETIRED (2026-09-26): port-tax tickets were never sold (Wompi disabled), so there
// is nothing to list. The route stays so old links, the native shell and Bookings
// history never 404; it lands on the official pier / park / insurance prices.
export default function PortTaxTicketsRedirect() {
  return <Redirect href={'/ciudad/muelle-bodeguita' as any} />;
}
