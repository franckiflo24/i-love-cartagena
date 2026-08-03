// Drop 8 — medal catalog. The SERVER decides what is earned (from real
// verified discoveries only); this file only knows how each key looks.
// A key the backend awards that isn't here renders with a fallback medal —
// never a crash, never a hidden award.

export interface AchievementDef {
  key: string;
  icon: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'primer_sello', icon: '🎫', name: 'Primer Sello', desc: 'Tu pasaporte existe — primer lugar sellado' },
  { key: 'diez_sellos', icon: '🔟', name: '10 Sellos', desc: 'Diez lugares reales, verificados caminando' },
  { key: 'veinticinco_sellos', icon: '🎖️', name: '25 Sellos', desc: 'La ciudad ya te reconoce' },
  { key: 'cincuenta_sellos', icon: '👑', name: '50 Sellos', desc: 'Cincuenta sellos — nivel leyenda' },
  { key: 'primer_sabor', icon: '🍽️', name: 'Primer Sabor', desc: 'Tu primer plato icónico, probado en el lugar' },
  { key: 'cinco_sabores', icon: '🥘', name: '5 Sabores', desc: 'Cinco platos de la colección' },
  { key: 'diez_sabores', icon: '🍤', name: '10 Sabores', desc: 'Mitad de la colección de sabores' },
  { key: 'paladar_maestro', icon: '🏆', name: 'Paladar Maestro', desc: 'Los 20 sabores de Cartagena — completos' },
  { key: 'primera_plaza', icon: '⛲', name: 'Primera Plaza', desc: 'Tu primera plaza sellada en persona' },
  { key: 'todas_las_plazas', icon: '🏛️', name: 'Todas las Plazas', desc: 'Las 12 plazas y rincones de la ciudad amurallada' },
  { key: 'primera_joya', icon: '💎', name: 'Primera Joya', desc: 'Una joya local te encontró' },
  { key: 'tres_joyas', icon: '✨', name: '3 Joyas', desc: 'Tres joyas locales reveladas' },
  { key: 'siete_joyas', icon: '🌟', name: '7 Joyas', desc: 'Siete joyas — ojo de local' },
  { key: 'racha_3', icon: '🔥', name: 'Racha de 3', desc: 'Tres días seguidos caminando' },
  { key: 'racha_7', icon: '⚡', name: 'Racha de 7', desc: 'Una semana entera de descubrimientos' },
  { key: 'racha_14', icon: '🌋', name: 'Racha de 14', desc: 'Dos semanas — esto ya es un hábito' },
  { key: 'racha_30', icon: '🐉', name: 'Racha de 30', desc: 'Un mes sellando — Cartagena es tuya' },
  { key: 'barrio_completo', icon: '🗝️', name: 'Barrio Completo', desc: 'Un barrio entero, sellado al 100%' },
  { key: 'noctambulo', icon: '🌙', name: 'Noctámbulo', desc: 'Un sello después de las 9 de la noche' },
  { key: 'madrugador', icon: '🌅', name: 'Madrugador', desc: 'Un sello antes de las 9 de la mañana' },
  { key: 'primera_ruta', icon: '🚶', name: 'Primera Ruta', desc: 'Una ruta completa, paso a paso' },
  { key: 'cuatro_rutas', icon: '🧵', name: 'Todas las Rutas', desc: 'Las 4 rutas de Cartagena completadas' },
  { key: 'misiones_5', icon: '🎯', name: '5 Misiones', desc: 'Cinco misiones diarias cumplidas' },
  { key: 'embajador', icon: '🤝', name: 'Embajador', desc: 'Un amigo se unió con tu código' },
];

const BY_KEY: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));

export function achievementDef(key: string): AchievementDef {
  return BY_KEY[key] || { key, icon: '🏅', name: key, desc: '' };
}
