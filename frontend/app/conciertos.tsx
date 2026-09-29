// Spanish alias of the retired /concerts — straight to the verified feed's concerts.
import { Redirect } from 'expo-router';

export default function ConciertosRedirect() {
  return <Redirect href={'/que-pasa?cat=concert' as never} />;
}
