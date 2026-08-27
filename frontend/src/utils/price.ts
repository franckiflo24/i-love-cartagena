// Single source of truth for event / partner price labels.
//
// CRITICAL RULE: a price of 0, null or undefined does NOT mean free. Many venues
// publish no public price ("a consultar por WhatsApp") — showing "GRATIS"/"FREE"
// for them is a lie (audit Aug 2026 found yacht charters labelled "Gratis").
// ONLY an explicit is_free flag renders GRATIS. An unpriced paid item reads
// "Consultar" — never "GRATIS" and never "$0K".
//
// Import this everywhere a price/free badge is rendered instead of re-deriving
// the logic inline, so the FALSE-FREE bug class cannot regenerate.
export function eventPriceLabel(
  price: number | null | undefined,
  isFree?: boolean | null,
  opts?: { cop?: boolean },
): string {
  if (isFree) return 'GRATIS';
  if (!price || price <= 0) return 'Consultar';
  return opts?.cop
    ? `$${Math.round(price).toLocaleString('es-CO')} COP`
    : `$${(price / 1000).toFixed(0)}K`;
}
