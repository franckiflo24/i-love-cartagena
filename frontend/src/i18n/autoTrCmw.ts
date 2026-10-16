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

  // ── Pre-registration (CMW-1, app/cmw.tsx) ──
  // The consent/marketing paragraphs are faithful DISPLAY translations (same
  // pattern as the privacy §g above); the record always stores the Spanish
  // canon + version from backend/cmw_prereg.py.
  '31 dic 2026 — 7 ene 2027 · Cartagena de Indias': {
    en: 'Dec 31, 2026 — Jan 7, 2027 · Cartagena de Indias',
    fr: '31 déc. 2026 — 7 janv. 2027 · Cartagena de Indias',
    pt: '31 dez 2026 — 7 jan 2027 · Cartagena de Indias',
  },
  'Preinscríbete a la preventa': { en: 'Pre-register for the presale', fr: 'Préinscris-toi à la prévente', pt: 'Faça sua pré-inscrição para a pré-venda' },
  // ── CMW-2: apellido/género fields + referral block + panel wall ──
  'Apellidos': { en: 'Last name', fr: 'Nom de famille', pt: 'Sobrenome' },
  'Género': { en: 'Gender', fr: 'Genre', pt: 'Gênero' },
  'Femenino': { en: 'Female', fr: 'Féminin', pt: 'Feminino' },
  'Masculino': { en: 'Male', fr: 'Masculin', pt: 'Masculino' },
  'Otro': { en: 'Other', fr: 'Autre', pt: 'Outro' },
  'Prefiero no decir': { en: 'Prefer not to say', fr: 'Je préfère ne pas le dire', pt: 'Prefiro não dizer' },
  'Invita a tus amigos': { en: 'Invite your friends', fr: 'Invite tes amis', pt: 'Convide seus amigos' },
  'Comparte tu enlace: quien se preinscriba contigo también recibe el aviso de preventa primero.': {
    en: 'Share your link: whoever pre-registers through you also gets the presale notice first.',
    fr: 'Partage ton lien : qui se préinscrit avec toi reçoit aussi l’avis de prévente en premier.',
    pt: 'Compartilhe seu link: quem se pré-inscrever com você também recebe o aviso da pré-venda primeiro.',
  },
  'Copiar enlace': { en: 'Copy link', fr: 'Copier le lien', pt: 'Copiar link' },
  'Número de preinscripción y código de invitación': { en: 'Pre-registration number & invite code', fr: 'Numéro de préinscription et code d’invitation', pt: 'Número de pré-inscrição e código de convite' },
  'Solo administradores': { en: 'Admins only', fr: 'Réservé aux admins', pt: 'Somente administradores' },
  'Inicia sesión con una cuenta administradora de AMO.': { en: 'Sign in with an AMO admin account.', fr: 'Connecte-toi avec un compte administrateur AMO.', pt: 'Entre com uma conta administradora da AMO.' },
  'Panel de preinscripciones': { en: 'Pre-registration panel', fr: 'Panneau des préinscriptions', pt: 'Painel de pré-inscrições' },
  // ── CMW-3: the guided one-question-at-a-time pre-registration flow ──
  '¿Cómo te llamas?': { en: 'What’s your name?', fr: 'Comment tu t’appelles ?', pt: 'Como você se chama?' },
  'Como aparece en tu documento.': { en: 'As it appears on your ID.', fr: 'Comme sur ta pièce d’identité.', pt: 'Como aparece no seu documento.' },
  'Tu correo': { en: 'Your email', fr: 'Ton e-mail', pt: 'Seu e-mail' },
  '¿A qué correo te avisamos?': { en: 'Which email should we notify?', fr: 'À quelle adresse on te prévient ?', pt: 'Para qual e-mail avisamos?' },
  'Ahí llega el aviso de la preventa.': { en: 'That’s where the presale notice lands.', fr: 'C’est là qu’arrive l’avis de prévente.', pt: 'É aí que chega o aviso da pré-venda.' },
  '¿Cuál es tu WhatsApp?': { en: 'What’s your WhatsApp?', fr: 'Quel est ton WhatsApp ?', pt: 'Qual é o seu WhatsApp?' },
  'Con indicativo del país. Ej: +57 300 123 4567': { en: 'With country code. E.g. +57 300 123 4567', fr: 'Avec l’indicatif du pays. Ex. : +57 300 123 4567', pt: 'Com código do país. Ex.: +57 300 123 4567' },
  '¿Cuándo naciste?': { en: 'When were you born?', fr: 'Quand es-tu né·e ?', pt: 'Quando você nasceu?' },
  'La preventa es solo para mayores de 18 años.': { en: 'The presale is 18+ only.', fr: 'La prévente est réservée aux 18 ans et plus.', pt: 'A pré-venda é apenas para maiores de 18 anos.' },
  '¿Cuál es tu Instagram?': { en: 'What’s your Instagram?', fr: 'Quel est ton Instagram ?', pt: 'Qual é o seu Instagram?' },
  'Así te reconocemos y te compartimos el line-up.': { en: 'That’s how we know you and share the line-up.', fr: 'C’est ainsi qu’on te reconnaît et qu’on partage le line-up.', pt: 'É assim que te reconhecemos e compartilhamos o line-up.' },
  'De dónde vienes': { en: 'Where you’re from', fr: 'D’où tu viens', pt: 'De onde você vem' },
  '¿Desde dónde nos visitas?': { en: 'Where are you visiting from?', fr: 'D’où nous rends-tu visite ?', pt: 'De onde você nos visita?' },
  'Nos ayuda a organizar la preventa. Opcional.': { en: 'It helps us plan the presale. Optional.', fr: 'Ça nous aide à organiser la prévente. Facultatif.', pt: 'Ajuda a organizar a pré-venda. Opcional.' },
  'Último paso': { en: 'Last step', fr: 'Dernière étape', pt: 'Último passo' },
  'Revisa y confirma': { en: 'Review and confirm', fr: 'Vérifie et confirme', pt: 'Revise e confirme' },
  'Nacimiento': { en: 'Date of birth', fr: 'Naissance', pt: 'Nascimento' },
  'Confirmar preinscripción': { en: 'Confirm pre-registration', fr: 'Confirmer la préinscription', pt: 'Confirmar pré-inscrição' },
  'Menos de 1 minuto': { en: 'Under a minute', fr: 'Moins d’une minute', pt: 'Menos de 1 minuto' },
  'Datos protegidos': { en: 'Your data is protected', fr: 'Données protégées', pt: 'Dados protegidos' },
  'Usaremos los datos de tu cuenta.': { en: 'We’ll use your account details.', fr: 'On utilisera les données de ton compte.', pt: 'Usaremos os dados da sua conta.' },
  'Usaremos los datos de tu cuenta. Solo te pedimos lo que falta.': { en: 'We’ll use your account details. We only ask for what’s missing.', fr: 'On utilisera les données de ton compte. On ne demande que ce qui manque.', pt: 'Usaremos os dados da sua conta. Só pedimos o que falta.' },
  'Solo faltan': { en: 'Only missing', fr: 'Il ne manque que', pt: 'Faltam apenas' },
  'Estás en la lista': { en: 'You’re on the list', fr: 'Tu es sur la liste', pt: 'Você está na lista' },
  'Los preinscritos reciben el aviso de la preventa antes que el público general.': {
    en: 'Pre-registered guests get the presale notice before the general public.',
    fr: 'Les préinscrits reçoivent l’annonce de la prévente avant le grand public.',
    pt: 'Os pré-inscritos recebem o aviso da pré-venda antes do público geral.',
  },
  'Preinscripción gestionada por AMO.': { en: 'Pre-registration managed by AMO.', fr: 'Préinscription gérée par AMO.', pt: 'Pré-inscrição gerenciada pela AMO.' },
  'Preinscripción recibida': { en: 'Pre-registration received', fr: 'Préinscription reçue', pt: 'Pré-inscrição recebida' },
  'Ya estabas en la lista: actualizamos tus datos.': {
    en: 'You were already on the list: we updated your details.',
    fr: 'Tu étais déjà sur la liste : nous avons mis à jour tes informations.',
    pt: 'Você já estava na lista: atualizamos seus dados.',
  },
  'Número de preinscripción': { en: 'Pre-registration number', fr: 'Numéro de préinscription', pt: 'Número de pré-inscrição' },
  'Termina tu perfil en la app AMO': { en: 'Finish your profile in the AMO app', fr: 'Termine ton profil dans l’app AMO', pt: 'Complete seu perfil no app AMO' },
  'El programa, tus solicitudes al concierge y el aviso de preventa, todo en un solo lugar.': {
    en: 'The program, your concierge requests and the presale notice, all in one place.',
    fr: 'Le programme, tes demandes au concierge et l’annonce de la prévente, tout au même endroit.',
    pt: 'O programa, suas solicitações ao concierge e o aviso da pré-venda, tudo em um só lugar.',
  },
  'Descargar en el App Store': { en: 'Download on the App Store', fr: 'Télécharger sur l’App Store', pt: 'Baixar na App Store' },
  'Usaremos estos datos de tu cuenta. Solo te pedimos lo que falta.': {
    en: 'We’ll use these details from your account. We only ask for what’s missing.',
    fr: 'Nous utiliserons ces informations de ton compte. Nous ne demandons que ce qui manque.',
    pt: 'Usaremos estes dados da sua conta. Só pedimos o que falta.',
  },
  '¿Ya tienes cuenta AMO?': { en: 'Already have an AMO account?', fr: 'Tu as déjà un compte AMO ?', pt: 'Já tem conta AMO?' },
  'Fecha de nacimiento': { en: 'Date of birth', fr: 'Date de naissance', pt: 'Data de nascimento' },
  'Solo mayores de 18 años.': { en: '18 and over only.', fr: 'Réservé aux 18 ans et plus.', pt: 'Somente maiores de 18 anos.' },
  'País': { en: 'Country', fr: 'Pays', pt: 'País' },
  'Autorización de datos': { en: 'Data authorization', fr: 'Autorisation des données', pt: 'Autorização de dados' },
  'Autorizo a Amo Cartagena S.A.S. a tratar mis datos personales con la finalidad de gestionar mi preinscripción a Cartagena Music Week, conforme a la Ley 1581 de 2012 y la Política de Privacidad. Conozco mi derecho a consultar, actualizar, rectificar, suprimir y revocar esta autorización escribiendo a privacidad@amocartagena.co.': {
    en: 'I authorize Amo Cartagena S.A.S. to process my personal data for the purpose of managing my pre-registration for Cartagena Music Week, in accordance with Colombia’s Law 1581 of 2012 and the Privacy Policy. I know my right to access, update, rectify and delete my data and to revoke this authorization by writing to privacidad@amocartagena.co.',
    fr: 'J’autorise Amo Cartagena S.A.S. à traiter mes données personnelles afin de gérer ma préinscription à Cartagena Music Week, conformément à la loi colombienne 1581 de 2012 et à la Politique de confidentialité. Je connais mon droit de consulter, mettre à jour, rectifier et supprimer mes données et de révoquer cette autorisation en écrivant à privacidad@amocartagena.co.',
    pt: 'Autorizo a Amo Cartagena S.A.S. a tratar meus dados pessoais com a finalidade de gerenciar minha pré-inscrição na Cartagena Music Week, conforme a Lei colombiana 1581 de 2012 e a Política de Privacidade. Conheço meu direito de consultar, atualizar, retificar, excluir e revogar esta autorização escrevendo para privacidad@amocartagena.co.',
  },
  'Quiero recibir noticias, preventas y avisos de Cartagena Music Week por WhatsApp y correo.': {
    en: 'I want to receive Cartagena Music Week news, presales and notices by WhatsApp and email.',
    fr: 'Je veux recevoir les nouvelles, préventes et annonces de Cartagena Music Week par WhatsApp et e-mail.',
    pt: 'Quero receber notícias, pré-vendas e avisos da Cartagena Music Week por WhatsApp e e-mail.',
  },
  'Preinscribirme': { en: 'Pre-register me', fr: 'Me préinscrire', pt: 'Fazer pré-inscrição' },
  'Escribe un correo válido.': { en: 'Enter a valid email.', fr: 'Saisis un e-mail valide.', pt: 'Digite um e-mail válido.' },
  'Escribe un número de WhatsApp con indicativo.': {
    en: 'Enter a WhatsApp number with country code.',
    fr: 'Saisis un numéro WhatsApp avec l’indicatif du pays.',
    pt: 'Digite um número de WhatsApp com o código do país.',
  },
  'Escribe tu fecha de nacimiento completa (DD/MM/AAAA).': {
    en: 'Enter your full date of birth (DD/MM/YYYY).',
    fr: 'Saisis ta date de naissance complète (JJ/MM/AAAA).',
    pt: 'Digite sua data de nascimento completa (DD/MM/AAAA).',
  },
  'La preinscripción es solo para mayores de 18 años.': {
    en: 'Pre-registration is 18+ only.',
    fr: 'La préinscription est réservée aux 18 ans et plus.',
    pt: 'A pré-inscrição é somente para maiores de 18 anos.',
  },
  'Marca la autorización de datos para continuar.': {
    en: 'Tick the data authorization to continue.',
    fr: 'Coche l’autorisation des données pour continuer.',
    pt: 'Marque a autorização de dados para continuar.',
  },
  'Demasiadas solicitudes. Intenta de nuevo en una hora.': {
    en: 'Too many requests. Try again in an hour.',
    fr: 'Trop de demandes. Réessaie dans une heure.',
    pt: 'Muitas solicitações. Tente novamente em uma hora.',
  },
  'Sin conexión. Revisa tu red e intenta de nuevo.': {
    en: 'No connection. Check your network and try again.',
    fr: 'Pas de connexion. Vérifie ton réseau et réessaie.',
    pt: 'Sem conexão. Verifique sua rede e tente novamente.',
  },
  'Revisa los datos e intenta de nuevo.': { en: 'Check your details and try again.', fr: 'Vérifie les informations et réessaie.', pt: 'Confira os dados e tente novamente.' },
  'El texto de autorización cambió. Recarga la página e inténtalo de nuevo.': {
    en: 'The consent text changed. Reload the page and try again.',
    fr: 'Le texte d’autorisation a changé. Recharge la page et réessaie.',
    pt: 'O texto de autorização mudou. Recarregue a página e tente novamente.',
  },
  'El servicio no está disponible en este momento. Intenta de nuevo.': {
    en: 'The service is unavailable right now. Please try again.',
    fr: 'Le service n’est pas disponible pour le moment. Réessaie.',
    pt: 'O serviço não está disponível no momento. Tente novamente.',
  },
};
