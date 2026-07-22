// Curated occasion collections — mirror of backend occasions.COLLECTIONS.
// Used by the home rail and as offline fallback on the collection screen.
export const COLLECTION_DEFS: Record<string, {
  icon: string; title_es: string; title_en: string; desc_es: string; desc_en: string;
  tags_any: string[]; categories?: string[];
}> = {
  'cena-romantica': { icon: 'heart', title_es: 'Cenas Románticas', title_en: 'Romantic Dinners', desc_es: 'Velas, vista y ambiente para dos', desc_en: 'Candles, views and a table for two', tags_any: ['romantic'], categories: ['restaurant', 'bar'] },
  'rooftops-atardecer': { icon: 'sunny', title_es: 'Rooftops al Atardecer', title_en: 'Sunset Rooftops', desc_es: 'La hora dorada sobre la ciudad amurallada', desc_en: 'Golden hour above the walled city', tags_any: ['rooftop', 'sunset_view'], categories: ['bar', 'restaurant', 'club', 'hotel'] },
  'primera-cita': { icon: 'cafe', title_es: 'Primera Cita', title_en: 'First Date', desc_es: 'Con encanto, sin exagerar', desc_en: 'Charming without trying too hard', tags_any: ['first_date'], categories: ['restaurant', 'cafe', 'bar'] },
  'con-ninos': { icon: 'happy', title_es: 'Con Niños', title_en: 'Kid-Friendly', desc_es: 'Planes donde los peques también gozan', desc_en: 'Places where the little ones have fun too', tags_any: ['kid_friendly', 'family'] },
  'dia-de-lluvia': { icon: 'rainy', title_es: 'Día de Lluvia', title_en: 'Rainy Day', desc_es: 'Bajo techo y con aire — que llueva lo que quiera', desc_en: 'Indoors and air-conditioned — let it pour', tags_any: ['indoor'] },
  'musica-en-vivo': { icon: 'musical-notes', title_es: 'Música en Vivo', title_en: 'Live Music', desc_es: 'Salsa, jazz y champeta en directo', desc_en: 'Salsa, jazz and champeta, live', tags_any: ['live_music'] },
  'favoritos-locales': { icon: 'location', title_es: 'Favoritos Locales', title_en: 'Local Favorites', desc_es: 'Donde comen los cartageneros, no los tours', desc_en: 'Where cartageneros actually eat', tags_any: ['local_favorite'] },
  'lujo-total': { icon: 'diamond', title_es: 'Lujo Total', title_en: 'Pure Luxury', desc_es: 'La experiencia premium de Cartagena', desc_en: 'Cartagena at its most premium', tags_any: ['luxury'], categories: ['restaurant', 'hotel', 'beach_club', 'yacht', 'spa'] },
};
