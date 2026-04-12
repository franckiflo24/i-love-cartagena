# Cartagena Music Week App - PRD

## Visión del Producto
Plataforma digital oficial de experiencia de ciudad para Cartagena Music Week. La app guía al turista, conecta el ecosistema (venues, hoteles, restaurantes, beach clubs, wellness), da confianza (precios claros, partners validados, reservas simples) y genera datos e ingresos.

## Tech Stack
- **Frontend:** Expo/React Native (SDK 54) con expo-router
- **Backend:** FastAPI + MongoDB
- **Auth:** Google Social Login (Emergent)
- **Design:** Dark theme (#050814) + Sunset Gold (#D97706)

## Features Implementadas (MVP v1)

### 1. Agenda Oficial
- Programación completa por día (12-16 Enero 2026)
- 15 eventos: sunsets, conciertos, wellness, brunches, beach clubs, after parties, candlelight, pop-ups, cultural
- Filtros por: día, tipo de experiencia, gratis/pago
- Detalle de cada evento con descripción, fotos, horario, precio, ubicación

### 2. Mapa/Venues
- 10 venues activos: La Muralla, Templo, Casa Bohème, Bellini, Café del Mar, Blue Apple Beach, Fénix, San Pedro Claver, Hotel Santa Clara, Isla Barú
- Filtros por tipo de venue
- Direcciones vía Google Maps
- Links de reserva directa

### 3. Partners Certificados
- 8 partners con sello de calidad CMW
- Categorías: restaurantes, clubs, beach clubs, hoteles, wellness
- Experiencia propuesta, rango de precio, reserva directa, ubicación

### 4. Reserva y Ticketing
- Links externos de reserva integrados
- Acceso a eventos gratuitos sin registro

### 5. Transporte Integrado
- 4 rutas: lanchas a Islas del Rosario, Isla Barú, transporte nocturno, shuttle aeropuerto
- Horarios, precios, puntos de salida
- Última lancha/servicio

### 6. Itinerarios Curados
- Ruta Lifestyle (spinning → brunch → beach → sunset → cena → Templo)
- Ruta Cultura (art gallery → centro histórico → folklore → candlelight)
- Ruta Premium (yoga → almuerzo VIP → boat transfer → sunset VIP → cena → mesa VIP)

### 7. Perfil y Mi Semana
- Google Social Login
- Favoritos
- Mi Semana (itinerario personal)
- Notificaciones in-app

### 8. Notificaciones
- Notificaciones broadcast y personalizadas
- Tipos: evento, transporte, general

## API Endpoints
- `GET /api/events` - Lista con filtros (date, type, is_free)
- `GET /api/events/featured` - Eventos destacados
- `GET /api/events/{id}` - Detalle de evento
- `GET /api/venues` - Lista de venues
- `GET /api/partners` - Lista de partners
- `GET /api/itineraries` - Itinerarios curados
- `GET /api/transport` - Rutas de transporte
- `GET /api/notifications` - Notificaciones (auth)
- `POST /api/favorites/toggle` - Toggle favorito (auth)
- `POST /api/my-week/toggle` - Toggle mi semana (auth)
- `POST /api/auth/session` - Exchange session
- `GET /api/auth/me` - User data
- `POST /api/auth/logout` - Logout

## Navegación
Bottom Tabs: Home → Agenda → Mapa → Partners → Perfil
Modal Screens: Event Detail, Partner Detail, Transport, Itineraries, Notifications

## Roadmap (v2)
- City Pass / Cartagena Pass
- Pagos integrados (Stripe)
- Paquetes premium
- Wallet digital
- Historial de reservas
- Recomendaciones personalizadas
- Analytics dashboard para alcaldía/sponsors
