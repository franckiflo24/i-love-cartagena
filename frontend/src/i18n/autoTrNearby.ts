// EVENTS-ELITE translations for proximity + map events layer (NearbyEventsCard, opt-in toggle, mapa eventos filter).
// Same contract as AUTO_TR in ./autoTr.ts: key = the exact Spanish UI string,
// value = { en, fr, pt } in tú voice (FR "tu", PT "você"). useTr() checks
// AUTO_TR first, then this table, so a key must live in ONE place only — grep
// autoTr.ts (both quote styles) before adding one here.
import type { Dict } from './autoTr';

export const NEARBY_TR: Dict = {
  // ── AvisameButton (§13 J6) ──
  'Avísame': { en: 'Remind me', fr: 'Préviens-moi', pt: 'Me avise' },
  'Te avisaremos': { en: "We'll remind you", fr: 'On te préviendra', pt: 'Vamos te avisar' },
  'Guardado': { en: 'Saved', fr: 'Enregistré', pt: 'Salvo' },
  'Listo · te avisamos antes de que empiece (máx. 1 aviso de eventos al día)': {
    en: "Done · we'll remind you before it starts (max. 1 event reminder a day)",
    fr: 'C’est fait · on te prévient avant le début (max. 1 rappel d’événement par jour)',
    pt: 'Pronto · vamos te avisar antes de começar (máx. 1 aviso de eventos por dia)',
  },
  'Guardado · no podremos avisarte a tiempo': {
    en: "Saved · we won't be able to remind you in time",
    fr: 'Enregistré · on ne pourra pas te prévenir à temps',
    pt: 'Salvo · não vamos conseguir te avisar a tempo',
  },
  'Guardado · tienes los recordatorios de eventos desactivados en Perfil': {
    en: 'Saved · your event reminders are turned off in Profile',
    fr: 'Enregistré · tes rappels d’événements sont désactivés dans ton Profil',
    pt: 'Salvo · seus lembretes de eventos estão desativados no Perfil',
  },
  'No pudimos guardarlo · intenta de nuevo': {
    en: "We couldn't save it · please try again",
    fr: 'Impossible de l’enregistrer · réessaie',
    pt: 'Não conseguimos salvar · tente de novo',
  },

  // ── NearbyEventsCard ──
  'Cerca de ti · verificado': { en: 'Near you · verified', fr: 'Près de toi · vérifié', pt: 'Perto de você · verificado' },
  'empieza en': { en: 'starts in', fr: 'commence dans', pt: 'começa em' },
  'verificado hoy': { en: 'verified today', fr: 'vérifié aujourd’hui', pt: 'verificado hoje' },
  'Tu ubicación no sale de tu teléfono': {
    en: 'Your location never leaves your phone',
    fr: 'Ta position ne quitte jamais ton téléphone',
    pt: 'Sua localização não sai do seu celular',
  },
  'Ocultar': { en: 'Hide', fr: 'Masquer', pt: 'Ocultar' },

  // ── Perfil › Notificaciones (§13 J7 / H3) ──
  'Recordatorios de eventos guardados': {
    en: 'Saved-event reminders',
    fr: 'Rappels des événements enregistrés',
    pt: 'Lembretes de eventos salvos',
  },
  'Hasta 3 h antes · 09:00–21:00 · máx. 1 al día': {
    en: 'Up to 3 h before · 09:00–21:00 · max. 1 a day',
    fr: 'Jusqu’à 3 h avant · 9 h–21 h · max. 1 par jour',
    pt: 'Até 3 h antes · 09:00–21:00 · máx. 1 por dia',
  },
  'Recordatorios de eventos que guardas — máximo 1 al día': {
    en: 'Reminders for events you save — max. 1 a day',
    fr: 'Rappels des événements que tu enregistres — 1 par jour maximum',
    pt: 'Lembretes dos eventos que você salva — no máximo 1 por dia',
  },
  'Permite las notificaciones para recibir tus recordatorios': {
    en: 'Allow notifications to get your reminders',
    fr: 'Autorise les notifications pour recevoir tes rappels',
    pt: 'Permita as notificações para receber seus lembretes',
  },
  'Activar en este navegador': { en: 'Turn on in this browser', fr: 'Activer dans ce navigateur', pt: 'Ativar neste navegador' },
  'Activos en este navegador': { en: 'On in this browser', fr: 'Activés dans ce navigateur', pt: 'Ativados neste navegador' },
  'Permitir notificaciones': { en: 'Allow notifications', fr: 'Autoriser les notifications', pt: 'Permitir notificações' },
  'Este navegador no puede recibir avisos': {
    en: "This browser can't receive notifications",
    fr: 'Ce navigateur ne peut pas recevoir de notifications',
    pt: 'Este navegador não pode receber notificações',
  },
  'Activa las notificaciones de AMO en Ajustes': {
    en: 'Turn on AMO notifications in Settings',
    fr: 'Active les notifications d’AMO dans les Réglages',
    pt: 'Ative as notificações do AMO nos Ajustes',
  },
  'Abrir Ajustes': { en: 'Open Settings', fr: 'Ouvrir les Réglages', pt: 'Abrir Ajustes' },
  'Inicia sesión para recibir recordatorios de los eventos que guardas': {
    en: 'Sign in to get reminders for the events you save',
    fr: 'Connecte-toi pour recevoir des rappels des événements que tu enregistres',
    pt: 'Entre para receber lembretes dos eventos que você salva',
  },
  'Eventos verificados cerca de mí': {
    en: 'Verified events near me',
    fr: 'Événements vérifiés près de moi',
    pt: 'Eventos verificados perto de mim',
  },
  'Para esta función tu ubicación se usa solo en tu teléfono; no la enviamos a AMO.': {
    en: 'For this feature your location is used only on your phone; we never send it to AMO.',
    fr: 'Pour cette fonction, ta position est utilisée uniquement sur ton téléphone ; nous ne l’envoyons pas à AMO.',
    pt: 'Para este recurso, sua localização é usada só no seu celular; não a enviamos para o AMO.',
  },
  'Sin permiso de ubicación: actívalo en Ajustes': {
    en: 'No location permission: turn it on in Settings',
    fr: 'Pas d’accès à la position : active-le dans les Réglages',
    pt: 'Sem permissão de localização: ative nos Ajustes',
  },
  'Qué eventos te interesan': {
    en: 'Events you care about',
    fr: 'Les événements qui t’intéressent',
    pt: 'Eventos do seu interesse',
  },
  'No pudimos guardar tu preferencia. Intenta de nuevo.': {
    en: "We couldn't save your preference. Please try again.",
    fr: 'Impossible d’enregistrer ta préférence. Réessaie.',
    pt: 'Não conseguimos salvar sua preferência. Tente de novo.',
  },

  // ── Privacidad (§13 J7) ──
  'c) Datos de dispositivo: token de notificaciones push, modelo y sistema operativo.': {
    en: 'c) Device data: push notification token, model and operating system.',
    fr: 'c) Données de l’appareil : jeton de notifications push, modèle et système d’exploitation.',
    pt: 'c) Dados do dispositivo: token de notificações push, modelo e sistema operacional.',
  },
  'f) Ubicación (solo si concedes permiso, opcional): la usamos para mostrarte lugares y eventos cercanos. No guardamos tu ubicación ni tu recorrido en nuestros servidores: cuando buscas lugares cercanos, le preguntas a Luna por algo cerca de ti o validas un sello del pasaporte, la posición se envía solo para responder esa consulta y no se almacena. Si eliges una "Mi base", guardamos ese punto en tu cuenta hasta que lo borres.': {
    en: 'f) Location (only if you grant permission, optional): we use it to show you nearby places and events. We do not store your location or your movements on our servers: when you search for nearby places, ask Luna for something near you, or validate a passport stamp, your position is sent only to answer that request and is not stored. If you choose a "Mi base" (home base), we keep that point on your account until you delete it.',
    fr: 'f) Position (uniquement si tu donnes l’autorisation, facultatif) : nous l’utilisons pour te montrer les lieux et événements proches. Nous ne stockons ni ta position ni tes déplacements sur nos serveurs : quand tu cherches des lieux proches, demandes à Luna quelque chose près de toi ou valides un tampon du passeport, ta position est envoyée uniquement pour répondre à cette demande et n’est pas conservée. Si tu choisis une « Mi base », nous gardons ce point sur ton compte jusqu’à ce que tu le supprimes.',
    pt: 'f) Localização (só se você der permissão, opcional): usamos para mostrar lugares e eventos próximos. Não guardamos sua localização nem seu trajeto em nossos servidores: quando você busca lugares próximos, pergunta à Luna por algo perto de você ou valida um selo do passaporte, a posição é enviada só para responder a essa consulta e não é armazenada. Se você escolher uma "Mi base", guardamos esse ponto na sua conta até você apagá-lo.',
  },
  '• Enviar notificaciones push relevantes: confirmaciones de tus reservas y recordatorios de los eventos que guardaste (hasta 3 h antes de que empiecen, solo entre las 09:00 y las 21:00, máximo 1 aviso de eventos al día). Puedes desactivarlos en Perfil › Notificaciones.': {
    en: '• Send relevant push notifications: confirmations of your bookings and reminders for the events you saved (up to 3 h before they start, only between 09:00 and 21:00, at most 1 event notification a day). You can turn them off in Profile › Notifications.',
    fr: '• T’envoyer des notifications push utiles : confirmations de tes réservations et rappels des événements que tu as enregistrés (jusqu’à 3 h avant le début, uniquement entre 9 h et 21 h, 1 notification d’événement par jour maximum). Tu peux les désactiver dans Profil › Notifications.',
    pt: '• Enviar notificações push relevantes: confirmações das suas reservas e lembretes dos eventos que você salvou (até 3 h antes de começarem, só entre 09:00 e 21:00, no máximo 1 aviso de eventos por dia). Você pode desativá-los em Perfil › Notificações.',
  },
  '• Eventos verificados cerca de ti (opcional, desactivado por defecto): si lo activas en Perfil › Notificaciones, tu teléfono compara tu ubicación con la agenda de eventos verificados. Ese cálculo se hace en tu teléfono; tu ubicación no se envía a AMO.': {
    en: '• Verified events near you (optional, off by default): if you turn it on in Profile › Notifications, your phone compares your location with the verified events calendar. That calculation happens on your phone; your location is not sent to AMO.',
    fr: '• Événements vérifiés près de toi (facultatif, désactivé par défaut) : si tu l’actives dans Profil › Notifications, ton téléphone compare ta position avec l’agenda des événements vérifiés. Ce calcul se fait sur ton téléphone ; ta position n’est pas envoyée à AMO.',
    pt: '• Eventos verificados perto de você (opcional, desativado por padrão): se você ativar em Perfil › Notificações, seu celular compara sua localização com a agenda de eventos verificados. Esse cálculo é feito no seu celular; sua localização não é enviada para o AMO.',
  },
  '• Servicios de notificaciones de tu navegador (por ejemplo Apple, Google o Mozilla) — entregan los avisos web solo si los activas.': {
    en: "• Your browser's notification services (for example Apple, Google or Mozilla) — they deliver web notifications only if you turn them on.",
    fr: '• Services de notification de ton navigateur (par exemple Apple, Google ou Mozilla) — ils délivrent les notifications web seulement si tu les actives.',
    pt: '• Serviços de notificação do seu navegador (por exemplo Apple, Google ou Mozilla) — entregam os avisos web só se você os ativar.',
  },
};
