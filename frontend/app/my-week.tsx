import { Redirect } from 'expo-router';
export default function MyWeekRedirect() {
  // "Mi semana" is the personal agenda view, not the city "salir" default.
  return <Redirect href={{ pathname: '/(tabs)/agenda', params: { mode: 'mi_agenda' } } as any} />;
}
