/**
 * Auto-translation dictionary for hardcoded Spanish strings.
 *
 * Usage in any screen:
 *   import { useTr } from '../src/i18n/autoTr';
 *   const tr = useTr();
 *   <Text>{tr('Todos')}</Text>   →  renders 'All' / 'Tous' / 'Todos' / 'Todos' depending on lang
 *
 * Strings NOT in this dictionary are returned as-is (original Spanish).
 * This lets us translate the app progressively without breaking anything.
 *
 * IMPORTANT: keys are the Spanish source text exactly as it appears in the UI.
 */
import { useLang } from '../context/LanguageContext';
import type { Lang } from './translations';

type Dict = Record<string, Partial<Record<Lang, string>>>;

export const AUTO_TR: Dict = {
  // Categories / Tabs
  'Todos': { en: 'All', fr: 'Tous', pt: 'Todos' },
  'Gastronomía': { en: 'Dining', fr: 'Gastronomie', pt: 'Gastronomia' },
  'Música': { en: 'Music', fr: 'Musique', pt: 'Música' },
  'Fiesta': { en: 'Party', fr: 'Fête', pt: 'Festa' },
  'Wellness': { en: 'Wellness', fr: 'Bien-être', pt: 'Bem-estar' },
  'Arte & Cultura': { en: 'Arts & Culture', fr: 'Arts & Culture', pt: 'Arte e Cultura' },
  'Pop-up': { en: 'Pop-up', fr: 'Pop-up', pt: 'Pop-up' },
  'Pasa día': { en: 'Day Pass', fr: 'Journée', pt: 'Passa o dia' },
  'Sunset Experience': { en: 'Sunset Experience', fr: 'Coucher de soleil', pt: 'Pôr do sol' },

  // Common actions
  'Cancelar': { en: 'Cancel', fr: 'Annuler', pt: 'Cancelar' },
  'Confirmar': { en: 'Confirm', fr: 'Confirmer', pt: 'Confirmar' },
  'Guardar': { en: 'Save', fr: 'Enregistrer', pt: 'Salvar' },
  'Eliminar': { en: 'Delete', fr: 'Supprimer', pt: 'Excluir' },
  'Quitar': { en: 'Remove', fr: 'Retirer', pt: 'Remover' },
  'Editar': { en: 'Edit', fr: 'Modifier', pt: 'Editar' },
  'Continuar': { en: 'Continue', fr: 'Continuer', pt: 'Continuar' },
  'Aceptar': { en: 'Accept', fr: 'Accepter', pt: 'Aceitar' },
  'Volver': { en: 'Back', fr: 'Retour', pt: 'Voltar' },
  'Siguiente': { en: 'Next', fr: 'Suivant', pt: 'Próximo' },
  'Atrás': { en: 'Back', fr: 'Précédent', pt: 'Anterior' },
  'Aplicar': { en: 'Apply', fr: 'Appliquer', pt: 'Aplicar' },
  'Buscar': { en: 'Search', fr: 'Rechercher', pt: 'Buscar' },
  'Cerrar': { en: 'Close', fr: 'Fermer', pt: 'Fechar' },
  'Compartir': { en: 'Share', fr: 'Partager', pt: 'Compartilhar' },
  'Ver todo': { en: 'See all', fr: 'Voir tout', pt: 'Ver tudo' },
  'Ver más': { en: 'See more', fr: 'Voir plus', pt: 'Ver mais' },
  'Ver detalle': { en: 'See details', fr: 'Voir détails', pt: 'Ver detalhes' },
  'Reservar': { en: 'Book', fr: 'Réserver', pt: 'Reservar' },
  'Reservar mesa': { en: 'Book a table', fr: 'Réserver une table', pt: 'Reservar mesa' },
  'Comprar': { en: 'Buy', fr: 'Acheter', pt: 'Comprar' },
  'Comprar entrada': { en: 'Buy ticket', fr: 'Acheter un billet', pt: 'Comprar ingresso' },
  'Cargar más': { en: 'Load more', fr: 'Charger plus', pt: 'Carregar mais' },

  // Time / dates
  'Hoy': { en: 'Today', fr: "Aujourd'hui", pt: 'Hoje' },
  'Mañana': { en: 'Tomorrow', fr: 'Demain', pt: 'Amanhã' },
  'Mañ': { en: 'Tom.', fr: 'Dem.', pt: 'Amh.' },
  'Ayer': { en: 'Yesterday', fr: 'Hier', pt: 'Ontem' },
  'Esta noche': { en: 'Tonight', fr: 'Ce soir', pt: 'Hoje à noite' },
  'Esta semana': { en: 'This week', fr: 'Cette semaine', pt: 'Esta semana' },
  'Este fin de semana': { en: 'This weekend', fr: 'Ce week-end', pt: 'Este fim de semana' },
  'Próximamente': { en: 'Coming soon', fr: 'Bientôt', pt: 'Em breve' },
  'Ahora': { en: 'Now', fr: 'Maintenant', pt: 'Agora' },
  'min': { en: 'min', fr: 'min', pt: 'min' },
  'horas': { en: 'hours', fr: 'heures', pt: 'horas' },

  // Day names short (sun-sat)
  'Dom': { en: 'Sun', fr: 'Dim', pt: 'Dom' },
  'Lun': { en: 'Mon', fr: 'Lun', pt: 'Seg' },
  'Mar': { en: 'Tue', fr: 'Mar', pt: 'Ter' },
  'Mié': { en: 'Wed', fr: 'Mer', pt: 'Qua' },
  'Jue': { en: 'Thu', fr: 'Jeu', pt: 'Qui' },
  'Vie': { en: 'Fri', fr: 'Ven', pt: 'Sex' },
  'Sáb': { en: 'Sat', fr: 'Sam', pt: 'Sáb' },

  // Month names short (jan-dec)
  'Ene': { en: 'Jan', fr: 'Jan', pt: 'Jan' },
  'Feb': { en: 'Feb', fr: 'Fév', pt: 'Fev' },
  'Mar.': { en: 'Mar', fr: 'Mar', pt: 'Mar' },  // 'Mar.' to disambiguate from 'Mar' (Tuesday)
  'Abr': { en: 'Apr', fr: 'Avr', pt: 'Abr' },
  'May': { en: 'May', fr: 'Mai', pt: 'Mai' },
  'Jun': { en: 'Jun', fr: 'Juin', pt: 'Jun' },
  'Jul': { en: 'Jul', fr: 'Juil', pt: 'Jul' },
  'Ago': { en: 'Aug', fr: 'Août', pt: 'Ago' },
  'Sep': { en: 'Sep', fr: 'Sep', pt: 'Set' },
  'Oct': { en: 'Oct', fr: 'Oct', pt: 'Out' },
  'Nov': { en: 'Nov', fr: 'Nov', pt: 'Nov' },
  'Dic': { en: 'Dec', fr: 'Déc', pt: 'Dez' },

  // Agenda screen
  'Qué hacer hoy en Cartagena': { en: 'What to do today in Cartagena', fr: 'Que faire aujourd\'hui à Carthagène', pt: 'O que fazer hoje em Cartagena' },
  'Tus eventos guardados': { en: 'Your saved events', fr: 'Vos événements enregistrés', pt: 'Seus eventos salvos' },
  'Quitar de mi agenda': { en: 'Remove from agenda', fr: 'Retirer de l\'agenda', pt: 'Remover da agenda' },
  'Mi agenda': { en: 'My agenda', fr: 'Mon agenda', pt: 'Minha agenda' },
  'Salir': { en: 'Going out', fr: 'Sortir', pt: 'Sair' },
  'Sin eventos': { en: 'No events', fr: 'Pas d\'événements', pt: 'Sem eventos' },
  'No hay eventos para esta categoría': { en: 'No events for this category', fr: 'Aucun événement pour cette catégorie', pt: 'Sem eventos nesta categoria' },
  'Evento': { en: 'Event', fr: 'Événement', pt: 'Evento' },
  'Eventos': { en: 'Events', fr: 'Événements', pt: 'Eventos' },

  // Filters
  'Filtrar': { en: 'Filter', fr: 'Filtrer', pt: 'Filtrar' },
  'Filtros': { en: 'Filters', fr: 'Filtres', pt: 'Filtros' },
  'Categoría': { en: 'Category', fr: 'Catégorie', pt: 'Categoria' },
  'Categorías': { en: 'Categories', fr: 'Catégories', pt: 'Categorias' },
  'Subcategoría': { en: 'Subcategory', fr: 'Sous-catégorie', pt: 'Subcategoria' },
  'Filtrar por presupuesto': { en: 'Filter by budget', fr: 'Filtrer par budget', pt: 'Filtrar por orçamento' },
  'Limpiar filtros': { en: 'Clear filters', fr: 'Effacer les filtres', pt: 'Limpar filtros' },
  'Todos los precios': { en: 'All prices', fr: 'Tous les prix', pt: 'Todos os preços' },

  // Partners
  'Partners': { en: 'Partners', fr: 'Partenaires', pt: 'Parceiros' },
  'Partner': { en: 'Partner', fr: 'Partenaire', pt: 'Parceiro' },
  'Restaurantes': { en: 'Restaurants', fr: 'Restaurants', pt: 'Restaurantes' },
  'Restaurante': { en: 'Restaurant', fr: 'Restaurant', pt: 'Restaurante' },
  'Hoteles': { en: 'Hotels', fr: 'Hôtels', pt: 'Hotéis' },
  'Hotel': { en: 'Hotel', fr: 'Hôtel', pt: 'Hotel' },
  'Beach clubs': { en: 'Beach clubs', fr: 'Beach clubs', pt: 'Beach clubs' },
  'Tours': { en: 'Tours', fr: 'Tours', pt: 'Tours' },
  'Vida nocturna': { en: 'Nightlife', fr: 'Vie nocturne', pt: 'Vida noturna' },
  'Lujo': { en: 'Luxury', fr: 'Luxe', pt: 'Luxo' },
  'Premium': { en: 'Premium', fr: 'Premium', pt: 'Premium' },
  'Popular': { en: 'Popular', fr: 'Populaire', pt: 'Popular' },
  'Elite': { en: 'Elite', fr: 'Élite', pt: 'Elite' },
  'Certificado': { en: 'Certified', fr: 'Certifié', pt: 'Certificado' },
  'Recomendado': { en: 'Recommended', fr: 'Recommandé', pt: 'Recomendado' },
  'Más populares': { en: 'Most popular', fr: 'Plus populaires', pt: 'Mais populares' },
  'Cocinas': { en: 'Cuisines', fr: 'Cuisines', pt: 'Cozinhas' },
  'Italiana': { en: 'Italian', fr: 'Italienne', pt: 'Italiana' },
  'Mariscos': { en: 'Seafood', fr: 'Fruits de mer', pt: 'Frutos do mar' },
  'Internacional': { en: 'International', fr: 'Internationale', pt: 'Internacional' },
  'Vegetariana': { en: 'Vegetarian', fr: 'Végétarienne', pt: 'Vegetariana' },
  'Local': { en: 'Local', fr: 'Locale', pt: 'Local' },
  'Asiática': { en: 'Asian', fr: 'Asiatique', pt: 'Asiática' },
  'Gastro': { en: 'Gastro', fr: 'Gastro', pt: 'Gastro' },
  'Árabe': { en: 'Arabic', fr: 'Arabe', pt: 'Árabe' },

  // City Pass
  'City Pass': { en: 'City Pass', fr: 'City Pass', pt: 'City Pass' },
  'Activar': { en: 'Activate', fr: 'Activer', pt: 'Ativar' },
  'Activar pase': { en: 'Activate pass', fr: 'Activer le pass', pt: 'Ativar passe' },
  'Mi pase': { en: 'My pass', fr: 'Mon pass', pt: 'Meu passe' },
  'Pase activo': { en: 'Active pass', fr: 'Pass actif', pt: 'Passe ativo' },
  'Beneficios': { en: 'Benefits', fr: 'Avantages', pt: 'Benefícios' },
  'Tu pase de la ciudad': { en: 'Your city pass', fr: 'Votre pass de la ville', pt: 'Seu passe da cidade' },
  'Acceso ilimitado': { en: 'Unlimited access', fr: 'Accès illimité', pt: 'Acesso ilimitado' },
  'Vence el': { en: 'Expires on', fr: 'Expire le', pt: 'Expira em' },
  'Válido por': { en: 'Valid for', fr: 'Valide pendant', pt: 'Válido por' },
  'días': { en: 'days', fr: 'jours', pt: 'dias' },

  // Transport / Port Tax
  'Transporte': { en: 'Transport', fr: 'Transport', pt: 'Transporte' },
  'Tasa Portuaria': { en: 'Port Tax', fr: 'Taxe portuaire', pt: 'Taxa Portuária' },
  'Pasajeros': { en: 'Passengers', fr: 'Passagers', pt: 'Passageiros' },
  'Pasajero': { en: 'Passenger', fr: 'Passager', pt: 'Passageiro' },
  'Fecha de viaje': { en: 'Travel date', fr: 'Date de voyage', pt: 'Data da viagem' },
  'Comprar Tasa Portuaria': { en: 'Buy Port Tax', fr: 'Acheter la Taxe portuaire', pt: 'Comprar Taxa Portuária' },
  'Mis tiquetes': { en: 'My tickets', fr: 'Mes billets', pt: 'Meus bilhetes' },
  'Tiquete': { en: 'Ticket', fr: 'Billet', pt: 'Bilhete' },
  'Total': { en: 'Total', fr: 'Total', pt: 'Total' },
  'Subtotal': { en: 'Subtotal', fr: 'Sous-total', pt: 'Subtotal' },
  'Pagar': { en: 'Pay', fr: 'Payer', pt: 'Pagar' },
  'Procesando…': { en: 'Processing…', fr: 'Traitement…', pt: 'Processando…' },

  // Auth
  'Iniciar sesión': { en: 'Sign in', fr: 'Se connecter', pt: 'Entrar' },
  'Crear cuenta': { en: 'Create account', fr: 'Créer un compte', pt: 'Criar conta' },
  'Cerrar sesión': { en: 'Sign out', fr: 'Se déconnecter', pt: 'Sair' },
  'Correo': { en: 'Email', fr: 'E-mail', pt: 'E-mail' },
  'Contraseña': { en: 'Password', fr: 'Mot de passe', pt: 'Senha' },
  'Nombre': { en: 'Name', fr: 'Nom', pt: 'Nome' },
  'Teléfono': { en: 'Phone', fr: 'Téléphone', pt: 'Telefone' },
  'Bienvenido': { en: 'Welcome', fr: 'Bienvenue', pt: 'Bem-vindo' },
  'Bienvenida': { en: 'Welcome', fr: 'Bienvenue', pt: 'Bem-vinda' },
  'Explorar como invitado': { en: 'Explore as guest', fr: 'Explorer en tant qu\'invité', pt: 'Explorar como visitante' },
  'Saltar': { en: 'Skip', fr: 'Passer', pt: 'Pular' },
  'Empezar': { en: 'Start', fr: 'Commencer', pt: 'Começar' },
  '¿Olvidaste tu contraseña?': { en: 'Forgot your password?', fr: 'Mot de passe oublié ?', pt: 'Esqueceu sua senha?' },
  '¿No tienes cuenta?': { en: "Don't have an account?", fr: 'Pas de compte ?', pt: 'Não tem conta?' },
  '¿Ya tienes cuenta?': { en: 'Already have an account?', fr: 'Déjà un compte ?', pt: 'Já tem conta?' },
  'Regístrate': { en: 'Sign up', fr: 'S\'inscrire', pt: 'Cadastre-se' },

  // Map
  'Mapa': { en: 'Map', fr: 'Carte', pt: 'Mapa' },
  'Ubicación': { en: 'Location', fr: 'Emplacement', pt: 'Localização' },
  'Dirección': { en: 'Address', fr: 'Adresse', pt: 'Endereço' },
  'Centro Histórico': { en: 'Historic Center', fr: 'Centre Historique', pt: 'Centro Histórico' },
  'Getsemaní': { en: 'Getsemaní', fr: 'Getsemaní', pt: 'Getsemaní' },
  'Bocagrande': { en: 'Bocagrande', fr: 'Bocagrande', pt: 'Bocagrande' },

  // Profile
  'Perfil': { en: 'Profile', fr: 'Profil', pt: 'Perfil' },
  'Mi perfil': { en: 'My profile', fr: 'Mon profil', pt: 'Meu perfil' },
  'Editar perfil': { en: 'Edit profile', fr: 'Modifier le profil', pt: 'Editar perfil' },
  'Favoritos': { en: 'Favorites', fr: 'Favoris', pt: 'Favoritos' },
  'Notificaciones': { en: 'Notifications', fr: 'Notifications', pt: 'Notificações' },
  'Idioma': { en: 'Language', fr: 'Langue', pt: 'Idioma' },
  'Ajustes': { en: 'Settings', fr: 'Paramètres', pt: 'Configurações' },
  'Acerca de': { en: 'About', fr: 'À propos', pt: 'Sobre' },
  'Términos': { en: 'Terms', fr: 'Conditions', pt: 'Termos' },
  'Privacidad': { en: 'Privacy', fr: 'Confidentialité', pt: 'Privacidade' },
  'Soporte': { en: 'Support', fr: 'Support', pt: 'Suporte' },
  'Acceso Partners': { en: 'Partner Access', fr: 'Accès Partenaires', pt: 'Acesso Parceiros' },

  // Status / Misc
  'Cargando…': { en: 'Loading…', fr: 'Chargement…', pt: 'Carregando…' },
  'Cargando': { en: 'Loading', fr: 'Chargement', pt: 'Carregando' },
  'Error': { en: 'Error', fr: 'Erreur', pt: 'Erro' },
  'Reintentar': { en: 'Retry', fr: 'Réessayer', pt: 'Tentar novamente' },
  'Sin conexión': { en: 'No connection', fr: 'Pas de connexion', pt: 'Sem conexão' },
  'Conectado': { en: 'Connected', fr: 'Connecté', pt: 'Conectado' },
  'Gratis': { en: 'Free', fr: 'Gratuit', pt: 'Grátis' },
  'Entrada libre': { en: 'Free entry', fr: 'Entrée libre', pt: 'Entrada livre' },
  'Lineup': { en: 'Lineup', fr: 'Lineup', pt: 'Lineup' },
  'Cómo llegar': { en: 'How to get there', fr: 'Comment y aller', pt: 'Como chegar' },
  'Live': { en: 'Live', fr: 'Live', pt: 'Live' },
  'Boats': { en: 'Boats', fr: 'Bateaux', pt: 'Barcos' },
  'Rutas': { en: 'Routes', fr: 'Routes', pt: 'Rotas' },
  'Itinerarios': { en: 'Itineraries', fr: 'Itinéraires', pt: 'Itinerários' },
  'Conciertos': { en: 'Concerts', fr: 'Concerts', pt: 'Shows' },
  'Concierto': { en: 'Concert', fr: 'Concert', pt: 'Show' },
  'Agenda': { en: 'Agenda', fr: 'Agenda', pt: 'Agenda' },
  'Sponsors': { en: 'Sponsors', fr: 'Sponsors', pt: 'Patrocinadores' },
  'Acceso rápido': { en: 'Quick access', fr: 'Accès rapide', pt: 'Acesso rápido' },
  'Mi lista': { en: 'My list', fr: 'Ma liste', pt: 'Minha lista' },
  'Programa': { en: 'Program', fr: 'Programme', pt: 'Programa' },
  'Destacados': { en: 'Featured', fr: 'À la une', pt: 'Destaques' },
  'shows': { en: 'shows', fr: 'shows', pt: 'shows' },
  'GRATIS': { en: 'FREE', fr: 'GRATUIT', pt: 'GRÁTIS' },

  // Search
  'Búsqueda': { en: 'Search', fr: 'Recherche', pt: 'Busca' },
  'Buscar en Cartagena…': { en: 'Search in Cartagena…', fr: 'Rechercher à Carthagène…', pt: 'Buscar em Cartagena…' },
  'Resultados': { en: 'Results', fr: 'Résultats', pt: 'Resultados' },
  'No se encontraron resultados': { en: 'No results found', fr: 'Aucun résultat', pt: 'Sem resultados' },
  'Sugerencias': { en: 'Suggestions', fr: 'Suggestions', pt: 'Sugestões' },

  // Itineraries
  'Itinerario': { en: 'Itinerary', fr: 'Itinéraire', pt: 'Itinerário' },
  'Lifestyle': { en: 'Lifestyle', fr: 'Lifestyle', pt: 'Lifestyle' },
  'Cultura': { en: 'Culture', fr: 'Culture', pt: 'Cultura' },
  'Musical': { en: 'Musical', fr: 'Musical', pt: 'Musical' },
  'Generar nuevo itinerario': { en: 'Generate new itinerary', fr: 'Générer un nouvel itinéraire', pt: 'Gerar novo itinerário' },
  'Generando itinerario…': { en: 'Generating itinerary…', fr: 'Génération de l\'itinéraire…', pt: 'Gerando itinerário…' },

  // Reservations / Booking
  'Reserva': { en: 'Booking', fr: 'Réservation', pt: 'Reserva' },
  'Reservas': { en: 'Bookings', fr: 'Réservations', pt: 'Reservas' },
  'Mi reserva': { en: 'My booking', fr: 'Ma réservation', pt: 'Minha reserva' },
  'Confirmada': { en: 'Confirmed', fr: 'Confirmée', pt: 'Confirmada' },
  'Pendiente': { en: 'Pending', fr: 'En attente', pt: 'Pendente' },
  'Cancelada': { en: 'Cancelled', fr: 'Annulée', pt: 'Cancelada' },
  'Personas': { en: 'People', fr: 'Personnes', pt: 'Pessoas' },
  'Persona': { en: 'Person', fr: 'Personne', pt: 'Pessoa' },

  // Onboarding / first impression
  'Descubre Cartagena': { en: 'Discover Cartagena', fr: 'Découvrez Carthagène', pt: 'Descubra Cartagena' },
  'Toda Cartagena en un solo lugar': { en: 'All of Cartagena in one place', fr: 'Tout Carthagène en un seul endroit', pt: 'Toda Cartagena em um só lugar' },
  'La ciudad en tu bolsillo': { en: 'The city in your pocket', fr: 'La ville dans votre poche', pt: 'A cidade no seu bolso' },
};

/**
 * Returns a memoized translator function based on the current language.
 * If the lang is 'es' or the key is missing, returns the original Spanish string.
 */
export function useTr() {
  const { lang } = useLang();
  return (esText: string | null | undefined): string => {
    if (!esText) return '';
    if (lang === 'es') return esText;
    const entry = AUTO_TR[esText];
    if (!entry) return esText; // fallback: original Spanish
    return entry[lang] || esText;
  };
}
