import { Redirect } from 'expo-router';
// /tasa-portuaria used to open the "Tasa portuaria oficial" checkout. No authority
// recognizes a single port tax and AMO has no agreement to sell the pier fee, so the
// link now lands on the honest module: official pier + park + insurance prices,
// paid at Muelle La Bodeguita.
export default function TasaPortuariaRedirect() {
  return <Redirect href={'/ciudad/muelle-bodeguita' as any} />;
}
