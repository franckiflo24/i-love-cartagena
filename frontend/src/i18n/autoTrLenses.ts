// LENSES translations (docs/lenses/DESIGN.md §4): lens chips on mapa/explore, the
// Golden Hour time toggle + pin sheet, the coming-soon card, and Port Day.
// Same contract as AUTO_TR in ./autoTr.ts: key = the exact Spanish UI string,
// value = { en, fr, pt } in tú voice (FR "tu", PT "você"). useTr() checks the
// other tables first, so a key must live in ONE place only — grep autoTr.ts,
// autoTrEvents.ts, autoTrNearby.ts and autoTrCmw.ts before adding one here.
// Lens DATA strings (labels, taglines, notes) travel as L4 inside lenses.json —
// this table holds only UI chrome.
import type { Dict } from './autoTr';

export const LENSES_TR: Dict = {
  // ── chips + gate ──
  'Lentes': { en: 'Lenses', fr: 'Filtres', pt: 'Lentes' },
  'En construcción': { en: 'Coming soon', fr: 'En construction', pt: 'Em construção' },
  'sin verificar': { en: 'unverified', fr: 'non vérifié', pt: 'não verificado' },
  'Esta capa se abre cuando tengamos suficientes lugares verificados — sin promesas vacías.': {
    en: 'This layer opens once we have enough verified places — no empty promises.',
    fr: "Cette couche s'ouvre quand on aura assez de lieux vérifiés — pas de promesses vides.",
    pt: 'Esta camada abre quando tivermos lugares verificados suficientes — sem promessas vazias.',
  },
  'lugares verificados': { en: 'verified places', fr: 'lieux vérifiés', pt: 'lugares verificados' },

  // ── golden hour ──
  'Amanecer': { en: 'Sunrise', fr: 'Lever', pt: 'Amanhecer' },
  'Día': { en: 'Daytime', fr: 'Journée', pt: 'Dia' },
  'Atardecer': { en: 'Sunset', fr: 'Coucher', pt: 'Pôr do sol' },
  'El sol se pone': { en: 'Sunset is at', fr: 'Le soleil se couche à', pt: 'O sol se põe às' },
  'este mes': { en: 'this month', fr: 'ce mois-ci', pt: 'este mês' },
  'Ubicación aproximada': { en: 'Approximate location', fr: 'Emplacement approximatif', pt: 'Localização aproximada' },
  'Mejor luz': { en: 'Best light', fr: 'Meilleure lumière', pt: 'Melhor luz' },
  'Ver lugar': { en: 'View place', fr: 'Voir le lieu', pt: 'Ver o lugar' },
  'Última verificación': { en: 'Last verified', fr: 'Dernière vérification', pt: 'Última verificação' },
  'Lleno hoy por cruceros': { en: 'Crowded today (cruise day)', fr: "Bondé aujourd'hui (jour de croisière)", pt: 'Cheio hoje (dia de cruzeiro)' },

  // ── port day ──
  'Día de crucero': { en: 'Port day', fr: "Jour d'escale", pt: 'Dia de cruzeiro' },
  'Funciona sin conexión': { en: 'Works offline', fr: 'Fonctionne hors ligne', pt: 'Funciona offline' },
  'Regreso al barco': { en: 'Back to ship', fr: 'Retour au navire', pt: 'Volta ao navio' },
  'Hora de zarpe (all aboard)': { en: 'All-aboard time', fr: "Heure d'embarquement", pt: 'Hora do all aboard' },
  'Sal del Centro a esta hora': { en: 'Leave the Centro by', fr: 'Quitte le Centro à', pt: 'Saia do Centro até' },
  'Tarifas oficiales de taxi': { en: 'Official taxi fares', fr: 'Tarifs officiels de taxi', pt: 'Tarifas oficiais de táxi' },
  'Ver en Moverse': { en: 'Open in Getting around', fr: 'Voir dans Se déplacer', pt: 'Ver em Moverse' },
  'Itinerarios para tu escala': { en: 'Itineraries for your port call', fr: 'Itinéraires pour ton escale', pt: 'Roteiros para a sua escala' },
  'Hoy hay crucero en puerto': { en: 'Cruise ship in port today', fr: "Navire de croisière au port aujourd'hui", pt: 'Navio de cruzeiro no porto hoje' },
  'min': { en: 'min', fr: 'min', pt: 'min' },
  'horas': { en: 'hours', fr: 'heures', pt: 'horas' },
  'Mapa esquemático — funciona sin datos': {
    en: 'Schematic map — works with no data',
    fr: 'Carte schématique — fonctionne sans données',
    pt: 'Mapa esquemático — funciona sem dados',
  },
  'Define tu hora de zarpe': { en: 'Set your all-aboard time', fr: "Règle ton heure d'embarquement", pt: 'Defina sua hora de all aboard' },
  'Te avisamos con margen de 90 min': {
    en: "We flag a 90-min safety buffer",
    fr: 'On te signale une marge de 90 min',
    pt: 'Avisamos com margem de 90 min',
  },
};
