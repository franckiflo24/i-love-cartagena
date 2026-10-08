// CMW (Cartagena Music Week) translations: the hub, the event detail, the concierge
// request sheet, the Home card, the /que-pasa banner and the privacy paragraph.
// Same contract as AUTO_TR in ./autoTr.ts: key = the exact Spanish UI string,
// value = { en, fr, pt } in tú voice (FR "tu", PT "você"). useTr() checks
// AUTO_TR, then EVENTS_TR, then NEARBY_TR, then this table, so a key lives in
// ONE place only — run scratchpad trkeys.mjs (or grep both quote styles) before
// adding one here. Keys already elsewhere and reused by CMW screens: Consultar,
// Volver, Reintentar, Cerrar, Hoy, Mañana, Cómo llegar, Ver programa, Nota
// (opcional), Enviando…, Fiesta, Bienestar, Sunset, Gastronomía, Experiencias,
// Fecha, Hora, Lugar, Precio, Política de privacidad, Compartir, Ver detalles,
// Verifica tu conexión e intenta de nuevo, Por confirmar, Hora por confirmar.
//
// Honesty (docs/cmw/DESIGN.md §0): no translation here names an artist, a time,
// a price or a venue, and none says "confirmado" / "reservado" about a request.
import type { Dict } from './autoTr';

export const CMW_TR: Dict = {
  // ── Badges, chips, states ──
  'Programa oficial': { en: 'Official program', fr: 'Programme officiel', pt: 'Programa oficial' },
  'Lugar por confirmar': { en: 'Venue to be confirmed', fr: 'Lieu à confirmer', pt: 'Local a confirmar' },
  'Artista por confirmar': { en: 'Artist to be confirmed', fr: 'Artiste à confirmer', pt: 'Artista a confirmar' },
  'Punto de embarque por confirmar': { en: 'Boarding point to be confirmed', fr: "Point d'embarquement à confirmer", pt: 'Ponto de embarque a confirmar' },
  'Evento principal': { en: 'Main event', fr: 'Événement principal', pt: 'Evento principal' },
  'After': { en: 'After-party', fr: 'After', pt: 'After' },
  'Isla': { en: 'Island', fr: 'Île', pt: 'Ilha' },
  'Artista': { en: 'Artist', fr: 'Artiste', pt: 'Artista' },
  'Embarque': { en: 'Boarding', fr: 'Embarquement', pt: 'Embarque' },
  'Día {n}': { en: 'Day {n}', fr: 'Jour {n}', pt: 'Dia {n}' },

  // ── Hub ──
  'Ocho días': { en: 'Eight days', fr: 'Huit jours', pt: 'Oito dias' },
  'La historia se encuentra con nuevos ritmos.': { en: 'History meets new rhythms.', fr: "L'histoire rencontre de nouveaux rythmes.", pt: 'A história encontra novos ritmos.' },
  'Hablar con concierge': { en: 'Talk to the concierge', fr: 'Parler au concierge', pt: 'Falar com o concierge' },
  'Día a día': { en: 'Day by day', fr: 'Jour après jour', pt: 'Dia a dia' },
  'Solicitar acceso': { en: 'Request access', fr: "Demander l'accès", pt: 'Solicitar acesso' },
  'Ver lugar': { en: 'View venue', fr: 'Voir le lieu', pt: 'Ver local' },
  'Más allá de la música': { en: 'Beyond the music', fr: 'Au-delà de la musique', pt: 'Além da música' },
  'Las islas': { en: 'The islands', fr: 'Les îles', pt: 'As ilhas' },
  'Información práctica': { en: 'Practical info', fr: 'Infos pratiques', pt: 'Informações práticas' },
  'Todo lo que necesitas para una semana inolvidable': { en: 'Everything you need for an unforgettable week', fr: 'Tout ce dont tu as besoin pour une semaine inoubliable', pt: 'Tudo o que você precisa para uma semana inesquecível' },
  'Acceso a eventos': { en: 'Event access', fr: 'Accès aux événements', pt: 'Acesso aos eventos' },
  'Ver guía de la ciudad': { en: 'See the city guide', fr: 'Voir le guide de la ville', pt: 'Ver o guia da cidade' },
  'Ver muelle y traslados': { en: 'See the pier and transfers', fr: 'Voir le quai et les transferts', pt: 'Ver o píer e os traslados' },
  '{n} eventos · {d} días': { en: '{n} events · {d} days', fr: '{n} événements · {d} jours', pt: '{n} eventos · {d} dias' },
  'Concierge y asistencia': { en: 'Concierge & assistance', fr: 'Concierge et assistance', pt: 'Concierge e assistência' },
  'Contacto': { en: 'Contact', fr: 'Contact', pt: 'Contato' },
  'Escribir por WhatsApp': { en: 'Message on WhatsApp', fr: 'Écrire sur WhatsApp', pt: 'Escrever pelo WhatsApp' },
  'Escribir por WhatsApp ahora': { en: 'Message on WhatsApp now', fr: 'Écrire sur WhatsApp maintenant', pt: 'Escrever pelo WhatsApp agora' },
  'No pudimos cargar el programa': { en: "We couldn't load the program", fr: 'Impossible de charger le programme', pt: 'Não foi possível carregar a programação' },
  'Más del programa': { en: 'More from the program', fr: 'Plus du programme', pt: 'Mais da programação' },
  'Arte del evento': { en: 'Event art', fr: "Visuel de l'événement", pt: 'Arte do evento' },
  'El acceso se coordina con el concierge. No hay pagos en la app.': { en: 'Access is arranged with the concierge. No payments in the app.', fr: "L'accès s'organise avec le concierge. Aucun paiement dans l'app.", pt: 'O acesso é combinado com o concierge. Não há pagamentos no app.' },
  'Evento no encontrado en el programa': { en: 'Event not found in the program', fr: 'Événement introuvable dans le programme', pt: 'Evento não encontrado na programação' },
  'Volver al programa': { en: 'Back to the program', fr: 'Retour au programme', pt: 'Voltar à programação' },
  'Descubre el programa': { en: 'Discover the program', fr: 'Découvre le programme', pt: 'Descubra a programação' },

  // ── Home card / que-pasa banner ──
  'Hoy en Music Week': { en: 'Today at Music Week', fr: "Aujourd'hui à Music Week", pt: 'Hoje na Music Week' },
  'Faltan {n} días': { en: '{n} days to go', fr: 'Dans {n} jours', pt: 'Faltam {n} dias' },
  'Falta 1 día': { en: '1 day to go', fr: 'Dans 1 jour', pt: 'Falta 1 dia' },
  '{n} eventos hoy': { en: '{n} events today', fr: "{n} événements aujourd'hui", pt: '{n} eventos hoje' },
  '1 evento hoy': { en: '1 event today', fr: "1 événement aujourd'hui", pt: '1 evento hoje' },
  'Nada programado hoy · mira los próximos días': { en: 'Nothing scheduled today · see the next days', fr: "Rien de prévu aujourd'hui · regarde les prochains jours", pt: 'Nada programado hoje · veja os próximos dias' },

  // ── Request sheet ──
  'Solicitud al concierge': { en: 'Concierge request', fr: 'Demande au concierge', pt: 'Solicitação ao concierge' },
  'Consulta general': { en: 'General enquiry', fr: 'Demande générale', pt: 'Consulta geral' },
  'Tu nombre': { en: 'Your name', fr: 'Ton nom', pt: 'Seu nome' },
  'Número de personas': { en: 'Party size', fr: 'Nombre de personnes', pt: 'Número de pessoas' },
  'Menos personas': { en: 'Fewer people', fr: 'Moins de personnes', pt: 'Menos pessoas' },
  'Más personas': { en: 'More people', fr: 'Plus de personnes', pt: 'Mais pessoas' },
  '¿Cómo te contactamos?': { en: 'How should we reach you?', fr: 'Comment te contacter ?', pt: 'Como entramos em contato?' },
  'Correo electrónico': { en: 'Email', fr: 'E-mail', pt: 'E-mail' },
  'Número de WhatsApp con indicativo': { en: 'WhatsApp number with country code', fr: "Numéro WhatsApp avec l'indicatif", pt: 'Número de WhatsApp com código do país' },
  'Tu correo electrónico': { en: 'Your email', fr: 'Ton e-mail', pt: 'Seu e-mail' },
  'Mesa, traslados, fechas, lo que necesites': { en: 'Table, transfers, dates, anything you need', fr: 'Table, transferts, dates, tout ce dont tu as besoin', pt: 'Mesa, traslados, datas, o que você precisar' },
  'Al enviar, aceptas que el concierge de Cartagena Music Week te contacte.': { en: 'By sending, you agree that the Cartagena Music Week concierge may contact you.', fr: 'En envoyant, tu acceptes que le concierge de Cartagena Music Week te contacte.', pt: 'Ao enviar, você aceita que o concierge da Cartagena Music Week entre em contato com você.' },
  'Enviar solicitud': { en: 'Send request', fr: 'Envoyer la demande', pt: 'Enviar solicitação' },
  'Solicitud recibida': { en: 'Request received', fr: 'Demande reçue', pt: 'Solicitação recebida' },
  'Un concierge te contactará': { en: 'A concierge will contact you', fr: 'Un concierge te contactera', pt: 'Um concierge entrará em contato com você' },
  'Número de solicitud': { en: 'Request number', fr: 'Numéro de demande', pt: 'Número da solicitação' },
  'Guarda este número por si necesitas seguimiento.': { en: 'Keep this number in case you need to follow up.', fr: 'Garde ce numéro au cas où tu aurais besoin d’un suivi.', pt: 'Guarde este número caso precise de acompanhamento.' },

  // ── Errors (client validation mirrors the backend; the English half is the
  //    second line of every bilingual error) ──
  'Escribe tu nombre (2 a 80 caracteres).': { en: 'Enter your name (2 to 80 characters).', fr: 'Écris ton nom (2 à 80 caractères).', pt: 'Escreva seu nome (2 a 80 caracteres).' },
  'El número de personas debe estar entre 1 y 50.': { en: 'The party size must be between 1 and 50.', fr: 'Le nombre de personnes doit être entre 1 et 50.', pt: 'O número de pessoas deve estar entre 1 e 50.' },
  'Escribe un número de WhatsApp con indicativo o un correo válido.': { en: 'Enter a WhatsApp number with country code or a valid email.', fr: "Écris un numéro WhatsApp avec l'indicatif ou un e-mail valide.", pt: 'Escreva um número de WhatsApp com código do país ou um e-mail válido.' },
  'La nota puede tener hasta 500 caracteres.': { en: 'The note can be up to 500 characters.', fr: 'La note peut contenir jusqu’à 500 caractères.', pt: 'A nota pode ter até 500 caracteres.' },
  'Ese evento no está en el programa oficial.': { en: 'That event is not in the official program.', fr: "Cet événement n'est pas dans le programme officiel.", pt: 'Esse evento não está no programa oficial.' },
  'Necesitamos tu autorización para que el concierge te contacte.': { en: 'We need your consent so the concierge can contact you.', fr: 'Nous avons besoin de ton accord pour que le concierge te contacte.', pt: 'Precisamos da sua autorização para que o concierge entre em contato.' },
  'Demasiadas solicitudes. Intenta de nuevo en una hora o escríbenos por WhatsApp.': { en: 'Too many requests. Try again in an hour or message us on WhatsApp.', fr: 'Trop de demandes. Réessaie dans une heure ou écris-nous sur WhatsApp.', pt: 'Muitas solicitações. Tente de novo em uma hora ou escreva pelo WhatsApp.' },
  'El servicio no está disponible en este momento. Intenta de nuevo o escríbenos por WhatsApp.': { en: 'The service is unavailable right now. Try again or message us on WhatsApp.', fr: "Le service n'est pas disponible pour le moment. Réessaie ou écris-nous sur WhatsApp.", pt: 'O serviço não está disponível no momento. Tente de novo ou escreva pelo WhatsApp.' },
  'No pudimos enviar tu solicitud. Escríbenos por WhatsApp.': { en: "We couldn't send your request. Message us on WhatsApp.", fr: "Nous n'avons pas pu envoyer ta demande. Écris-nous sur WhatsApp.", pt: 'Não foi possível enviar sua solicitação. Escreva pelo WhatsApp.' },

  // ── Bookable RSVP nights rail (hub) ──
  'Entradas gratis': { en: 'Free tickets', fr: 'Entrées gratuites', pt: 'Entradas grátis' },
  'Reserva tu entrada': { en: 'Reserve your ticket', fr: 'Réserve ta place', pt: 'Reserve sua entrada' },
  'Cupos limitados · código QR verificable en puerta': {
    en: 'Limited spots · QR code verified at the door',
    fr: 'Places limitées · code QR vérifié à l’entrée',
    pt: 'Vagas limitadas · código QR verificável na porta',
  },
  'Reservar entrada': { en: 'Reserve ticket', fr: 'Réserver', pt: 'Reservar entrada' },

  // ── Disambiguation (hub footer, CALENDAR-INTEGRATION v1) ──
  'Music Week no es el Cartagena Festival de Música (música clásica, 9–17 de enero): son dos semanas distintas.': {
    en: 'Music Week is not the Cartagena Festival de Música (classical music, January 9–17): they are two different weeks.',
    fr: 'La Music Week n’est pas le Cartagena Festival de Música (musique classique, 9–17 janvier) : ce sont deux semaines différentes.',
    pt: 'A Music Week não é o Cartagena Festival de Música (música clássica, 9–17 de janeiro): são duas semanas diferentes.',
  },

  // ── Privacy (privacidad.tsx §2) ──
  'g) Solicitudes al concierge de Cartagena Music Week: guardamos tu nombre, el número de personas y el contacto que nos das (WhatsApp o correo) para que el concierge de Cartagena Music Week pueda comunicarse contigo. Puedes pedir que borremos esa solicitud escribiendo a privacidad@amocartagena.co.': {
    en: 'g) Cartagena Music Week concierge requests: we store your name, your party size and the contact you give us (WhatsApp or email) so the Cartagena Music Week concierge can reach you. You can ask us to delete that request by writing to privacidad@amocartagena.co.',
    fr: 'g) Demandes au concierge de Cartagena Music Week : nous conservons ton nom, le nombre de personnes et le contact que tu nous donnes (WhatsApp ou e-mail) pour que le concierge de Cartagena Music Week puisse te joindre. Tu peux demander la suppression de cette demande en écrivant à privacidad@amocartagena.co.',
    pt: 'g) Solicitações ao concierge da Cartagena Music Week: guardamos seu nome, o número de pessoas e o contato que você nos dá (WhatsApp ou e-mail) para que o concierge da Cartagena Music Week possa falar com você. Você pode pedir a exclusão dessa solicitação escrevendo para privacidad@amocartagena.co.',
  },
};
