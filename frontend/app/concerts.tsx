// /concerts is retired (EVENTS-ELITE §13 J5): the 12 concert rows it listed were
// fabricated seeds. Concerts are verified city events now, so every entry point
// (Perfil, map popups, old links, Luna) lands on the feed filtered to concerts.
import { Redirect } from 'expo-router';

export default function ConcertsRedirect() {
  return <Redirect href={'/que-pasa?cat=concert' as never} />;
}
