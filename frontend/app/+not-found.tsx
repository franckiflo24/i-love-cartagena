import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

export default function NotFoundScreen() {
  // Phones capitalize typed paths (/Mapa, /Explore) and the static export is
  // case-sensitive — retry the lowercase route once before falling back to Home.
  // (Served for every unknown URL via dist/404.html, copied in the build step.)
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const p = window.location.pathname;
    const lower = p.toLowerCase();
    if (lower !== p) {
      window.location.replace(lower + window.location.search + window.location.hash);
      return null;
    }
  }
  return <Redirect href="/(tabs)" />;
}
