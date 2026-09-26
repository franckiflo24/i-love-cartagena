import { Redirect } from 'expo-router';
// RETIRED (2026-09-26): the "Tasa portuaria oficial" checkout is gone. No authority
// recognizes a single port tax — leaving Muelle La Bodeguita is pier (Corpoturismo)
// + park (Parques Nacionales) + mandatory insurance, paid at the taquillas — and AMO
// sells none of it. The route stays (vercel.json rewrite, native shell, old links,
// Luna's legacy open_port_tax_checkout) and lands on the honest city-hub module.
export default function PortTaxCheckoutRedirect() {
  return <Redirect href={'/ciudad/muelle-bodeguita' as any} />;
}
