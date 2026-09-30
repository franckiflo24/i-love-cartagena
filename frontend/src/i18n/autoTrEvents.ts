// EVENTS-ELITE translations for the Qué pasa feed UI (que-pasa screen, event detail source/status block, Home/Agenda feed rails).
// Same contract as AUTO_TR in ./autoTr.ts: key = the exact Spanish UI string,
// value = { en, fr, pt } in tú voice (FR "tu", PT "você"). useTr() checks
// AUTO_TR first, then this table, so a key must live in ONE place only — grep
// autoTr.ts (both quote styles) before adding one here.
import type { Dict } from './autoTr';

export const EVENTS_TR: Dict = {
  // ── /que-pasa screen ──
  'Qué pasa en Cartagena': { en: "What's on in Cartagena", fr: 'Que faire à Carthagène', pt: 'O que rola em Cartagena' },
  'Solo eventos con fuente verificada': { en: 'Only events with a verified source', fr: 'Uniquement des événements à source vérifiée', pt: 'Só eventos com fonte verificada' },
  'Ver en el mapa': { en: 'See on the map', fr: 'Voir sur la carte', pt: 'Ver no mapa' },
  'Anunciados por su fuente, sin fecha exacta todavía': { en: 'Announced by their source, no exact date yet', fr: "Annoncés par leur source, sans date exacte pour l'instant", pt: 'Anunciados pela fonte, ainda sem data exata' },
  'No hay eventos confirmados para hoy — mira los próximos': { en: "No confirmed events today — check what's coming up", fr: "Aucun événement confirmé aujourd'hui — regarde les prochains", pt: 'Nenhum evento confirmado hoje — veja os próximos' },
  'No hay eventos confirmados esta semana': { en: 'No confirmed events this week', fr: 'Aucun événement confirmé cette semaine', pt: 'Nenhum evento confirmado esta semana' },
  'Aún no hay próximos eventos confirmados': { en: 'No confirmed upcoming events yet', fr: "Aucun événement confirmé à venir pour l'instant", pt: 'Ainda não há próximos eventos confirmados' },
  'No hay eventos de esta categoría en este periodo': { en: 'No events in this category for this period', fr: 'Aucun événement de cette catégorie sur cette période', pt: 'Nenhum evento desta categoria neste período' },
  'Ver todas las categorías': { en: 'See all categories', fr: 'Voir toutes les catégories', pt: 'Ver todas as categorias' },
  'Ver esta semana': { en: 'See this week', fr: 'Voir cette semaine', pt: 'Ver esta semana' },
  'Ver próximos': { en: 'See upcoming', fr: 'Voir les prochains', pt: 'Ver próximos' },
  'No pudimos cargar la agenda': { en: "We couldn't load the events", fr: "Nous n'avons pas pu charger l'agenda", pt: 'Não conseguimos carregar a agenda' },
  'Cada evento enlaza a la fuente que lo confirma.': { en: 'Every event links to the source that confirms it.', fr: 'Chaque événement renvoie à la source qui le confirme.', pt: 'Cada evento leva à fonte que o confirma.' },
  'Horarios y precios pueden cambiar: confirma siempre con el organizador.': { en: 'Times and prices can change: always check with the organizer.', fr: "Horaires et prix peuvent changer : vérifie toujours auprès de l'organisateur.", pt: 'Horários e preços podem mudar: sempre confirme com o organizador.' },
  'Hora por confirmar': { en: 'Time to be confirmed', fr: 'Heure à confirmer', pt: 'Horário a confirmar' },

  // ── Categories (EVENTS-ELITE §2) not already in AUTO_TR ──
  'Familia': { en: 'Family', fr: 'Famille', pt: 'Família' },
  'Cívico': { en: 'Civic', fr: 'Civique', pt: 'Cívico' },

  // ── Honesty labels (EventFeedUI) ──
  'Sin confirmar': { en: 'Unconfirmed', fr: 'Non confirmé', pt: 'Não confirmado' },
  'Sin confirmar · verifica con el organizador': { en: 'Unconfirmed · check with the organizer', fr: "Non confirmé · vérifie auprès de l'organisateur", pt: 'Não confirmado · confirme com o organizador' },
  'Publicado por {venue}': { en: 'Posted by {venue}', fr: 'Publié par {venue}', pt: 'Publicado por {venue}' },
  'Publicado por los locales': { en: 'Posted by the venues', fr: 'Publié par les établissements', pt: 'Publicado pelos locais' },
  'el local': { en: 'the venue', fr: "l'établissement", pt: 'o local' },
  'Agotado': { en: 'Sold out', fr: 'Complet', pt: 'Esgotado' },
  'verificado': { en: 'verified', fr: 'vérifié', pt: 'verificado' },
  'sin actualizar': { en: 'not updated', fr: 'non actualisé', pt: 'não atualizado' },
  'Sin conexión · agenda del {d}': { en: 'Offline · events as of {d}', fr: 'Hors ligne · agenda du {d}', pt: 'Sem conexão · agenda de {d}' },
  'Fecha por confirmar': { en: 'Date to be confirmed', fr: 'Date à confirmer', pt: 'Data a confirmar' },

  // ── /event/[id] status honesty + source block ──
  'Este evento ya no está confirmado': { en: 'This event is no longer confirmed', fr: "Cet événement n'est plus confirmé", pt: 'Este evento não está mais confirmado' },
  'La página oficial del evento ya no está disponible': { en: "The event's official page is no longer available", fr: "La page officielle de l'événement n'est plus disponible", pt: 'A página oficial do evento não está mais disponível' },
  'La fuente lo anuncia como cancelado o aplazado': { en: 'The source lists it as cancelled or postponed', fr: "La source l'annonce comme annulé ou reporté", pt: 'A fonte o anuncia como cancelado ou adiado' },
  'La fecha cambió y la estamos verificando': { en: 'The date changed and we are verifying it', fr: 'La date a changé et nous la vérifions', pt: 'A data mudou e estamos verificando' },
  'Este evento ya pasó': { en: 'This event has already happened', fr: 'Cet événement est déjà passé', pt: 'Este evento já aconteceu' },
  'No pudimos cargar el evento': { en: "We couldn't load the event", fr: "Nous n'avons pas pu charger l'événement", pt: 'Não conseguimos carregar o evento' },
  'Entradas': { en: 'Tickets', fr: 'Billets', pt: 'Ingressos' },
  'Ver fuente oficial': { en: 'See official source', fr: 'Voir la source officielle', pt: 'Ver fonte oficial' },
  'También': { en: 'Also', fr: 'Aussi', pt: 'Também' },
  'Ver qué más pasa en Cartagena': { en: "See what else is on in Cartagena", fr: "Voir quoi faire d'autre à Carthagène", pt: 'Ver o que mais rola em Cartagena' },
  'Quitar de favoritos': { en: 'Remove from favorites', fr: 'Retirer des favoris', pt: 'Remover dos favoritos' },
  'Descarga AMO Life para ver todo el programa': { en: 'Download AMO Life to see the full lineup', fr: 'Télécharge AMO Life pour voir tout le programme', pt: 'Baixe o AMO Life para ver toda a programação' },

  // ── Home (§13 J3) ──
  'Próximos confirmados': { en: 'Confirmed upcoming', fr: 'Prochains confirmés', pt: 'Próximos confirmados' },
  'Nada confirmado hoy · Ver todo →': { en: 'Nothing confirmed today · See all →', fr: "Rien de confirmé aujourd'hui · Tout voir →", pt: 'Nada confirmado hoje · Ver tudo →' },
  'Nada confirmado de día · Ver todo →': { en: 'Nothing confirmed during the day · See all →', fr: 'Rien de confirmé en journée · Tout voir →', pt: 'Nada confirmado durante o dia · Ver tudo →' },
  'Nada confirmado esta noche · Ver todo →': { en: 'Nothing confirmed tonight · See all →', fr: 'Rien de confirmé ce soir · Tout voir →', pt: 'Nada confirmado hoje à noite · Ver tudo →' },
  'Ver todo →': { en: 'See all →', fr: 'Tout voir →', pt: 'Ver tudo →' },

  // ── §16 Destacados, Ahora en Cartagena, clean calendar ──
  'Destacado': { en: 'Featured', fr: 'À la une', pt: 'Destaque' },
  'Ahora en Cartagena': { en: 'Now in Cartagena', fr: 'En ce moment à Carthagène', pt: 'Agora em Cartagena' },
  'En curso': { en: 'Happening now', fr: 'En cours', pt: 'Acontecendo agora' },
  'Empieza a las {t}': { en: 'Starts at {t}', fr: 'Commence à {t}', pt: 'Começa às {t}' },
  'Parte de: {name}': { en: 'Part of: {name}', fr: 'Fait partie de : {name}', pt: 'Parte de: {name}' },
  '1 evento del programa': { en: '1 event in the program', fr: '1 événement au programme', pt: '1 evento na programação' },
  '{n} eventos del programa': { en: '{n} events in the program', fr: '{n} événements au programme', pt: '{n} eventos na programação' },
  'Ver programa': { en: 'See program', fr: 'Voir le programme', pt: 'Ver programação' },
  'Ocultar programa': { en: 'Hide program', fr: 'Masquer le programme', pt: 'Ocultar programação' },
  'Ver toda la semana': { en: 'See the whole week', fr: 'Voir toute la semaine', pt: 'Ver a semana toda' },
  'Nada confirmado este día': { en: 'Nothing confirmed this day', fr: 'Rien de confirmé ce jour-là', pt: 'Nada confirmado neste dia' },
  'Nada confirmado hoy': { en: 'Nothing confirmed today', fr: "Rien de confirmé aujourd'hui", pt: 'Nada confirmado hoje' },
  // 2026-09-29 QA: one-line header, program counts, umbrella detail, empty feed, descriptive venues
  'Qué pasa': { en: "What's on", fr: 'Que faire', pt: 'O que rola' },
  '+{n} del programa': { en: '+{n} in the program', fr: '+{n} au programme', pt: '+{n} na programação' },
  'Ver en Qué pasa': { en: "See in What's on", fr: 'Voir dans Que faire', pt: 'Ver em O que rola' },
  'Ver programa en Qué pasa': { en: "See the program in What's on", fr: 'Voir le programme dans Que faire', pt: 'Ver a programação em O que rola' },
  'El programa completo está en Qué pasa': { en: "The full program is in What's on", fr: 'Le programme complet est dans Que faire', pt: 'A programação completa está em O que rola' },
  'Aún no hay eventos confirmados': { en: 'No confirmed events yet', fr: "Aucun événement confirmé pour l'instant", pt: 'Ainda não há eventos confirmados' },
  'Ver Cartagena Music Week': { en: 'See Cartagena Music Week', fr: 'Voir Cartagena Music Week', pt: 'Ver Cartagena Music Week' },
  'Varios escenarios · Cartagena de Indias': { en: 'Several venues · Cartagena', fr: 'Plusieurs lieux · Carthagène', pt: 'Vários locais · Cartagena' },

  // ── Agenda (Mi agenda) + Favorites ──
  'Ver pasados': { en: 'See past', fr: 'Voir les passés', pt: 'Ver passados' },
  'Mostrar pasados': { en: 'Show past', fr: 'Afficher les passés', pt: 'Mostrar passados' },
  'Ocultar pasados': { en: 'Hide past', fr: 'Masquer les passés', pt: 'Ocultar passados' },
  'PASADO': { en: 'PAST', fr: 'PASSÉ', pt: 'PASSADO' },
  'Eventos guardados': { en: 'Saved events', fr: 'Événements enregistrés', pt: 'Eventos salvos' },
};
