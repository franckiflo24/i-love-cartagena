import { Redirect } from 'expo-router';
export default function PartnerDashboardRedirect() {
  // Straight to the dashboard: it sends logged-out partners to login itself,
  // and login never forwarded an already-signed-in partner.
  return <Redirect href="/business/dashboard" />;
}
