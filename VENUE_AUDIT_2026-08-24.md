# Venue Closure Audit — Aug 24 2026

All 893 catalog partners verified against Google Places `businessStatus`
(name+address match, Cartagena location bias). Script: `backend/scripts/`
(`audit` run in session scratchpad; removals via `remove_closed_venues.py`).

## REMOVED (12) — permanently closed, hidden from app + Mongo (reversible: is_public=false)
- Café del Mar (ptr_W113, elite) — owner-confirmed by Franck; listing also gone from Maps
- Mr Rick Pizza and Beer (ptr_1353, elite) — Google: CLOSED_PERMANENTLY (match: Mr. Rick Pizza and Beer)
- Selina Cartagena Coworking (svc_029, standard) — Google: CLOSED_PERMANENTLY (match: Cowork Selina Cartagena)
- Carulla Bocagrande (svc_027, standard) — Google: CLOSED_PERMANENTLY (match: Carulla Bocagrande)
- Demente (ptr_occ_004, occasion-guide) — Google: CLOSED_PERMANENTLY (match: Demente BAR TAPAS)
- Donde Magola (ptr_occ_008, occasion-guide) — Google: CLOSED_PERMANENTLY (match: Restaurante Donde Magola)
- Restaurante Vegetariano Girasoles (ptr_occ_015, occasion-guide) — Google: CLOSED_PERMANENTLY (match: Restaurante Vegetariano Girasoles)
- Comisiones Eliel (svc_ex_009, standard) — Google: CLOSED_PERMANENTLY (match: Casa de cambios "Comisiones Eliel" currency exchange)
- Pose Club (ptr_V029, popular) — Google: CLOSED_PERMANENTLY (match: Pose Club Cartagena)
- El Boliche Cebichería (ptr_W105, popular) — Google: CLOSED_PERMANENTLY (match: El Boliche Ceviche)
- D'Gyros (ptr_R088, popular) — Google: CLOSED_PERMANENTLY (match: D´Gyros)
- Baruna Eco-Hostel (ptr_X1299, popular) — Google: CLOSED_PERMANENTLY (match: Baruna Eco-Hostel)

## TEMPORARILY CLOSED (8) — left live, Franck should confirm status
- Badillo Comisiones Money Exchange (svc_ex_006, standard) — Google: CLOSED_TEMPORARILY
- Bazurto Social Club (ptr_W130, elite) — Google: CLOSED_TEMPORARILY
- Kona (ptr_R005, popular) — Google: CLOSED_TEMPORARILY
- Norma (ptr_R041, premium) — Google: CLOSED_TEMPORARILY
- Boundless Coffee (ptr_W123, popular) — Google: CLOSED_TEMPORARILY
- La Pepita (ptr_R090, popular) — Google: CLOSED_TEMPORARILY
- Moshi (ptr_dv2_017, premium) — Google: CLOSED_TEMPORARILY
- La Diva (ptr_dv2_020, popular) — Google: CLOSED_TEMPORARILY

## NO GOOGLE LISTING FOUND (52) — NOT removed; needs human eyeball
Many are generic editorial service entries (casas de cambio, lavanderías,
rental stubs, app brands like iFood/InDriver) that never had a precise Google
listing — absence here is NOT proof of closure. Franck: scan for any you know
are gone and we'll remove them with the same script.

- Yeyanailscartagena (ptr_beauty_0535, beauty) — closest hit: Las Palmeras
- BODYBRITE MANGA (ptr_beauty_0528, beauty) — closest hit: Avenida Jimenez Calle 26 #18A - 19
- Casa Ritual — Wellness (ptr_CB_006, wellness) — closest hit: UMARI Spa
- Spa de uñas cejas y pestañas julis perez (ptr_beauty_0517, beauty) — closest hit: Oasi Spa Getsemani Cartagena
- La Parisienne (ptr_CB_004, activity) — closest hit: Sierpe Caribe Fusión
- Clínica Medihelp — Bocagrande (svc_032, service) — closest hit: Medihelp Clinic Services
- InDriver Cartagena (svc_036, service) — closest hit: None
- Scooter Rental Cartagena — Getsemaní (svc_038, service) — closest hit: Cartagena Electric Bike Rent
- Golf Cart Rentals Cartagena (svc_039, service) — closest hit: JA CAR RENTAL
- Barbería El Caribe — Getsemaní (svc_046, service) — closest hit: LB Barber shop Getsemaní
- Pet Shop & Vet — Bocagrande (svc_049, service) — closest hit: Mascotas 24H
- Casa de Cambio Unidas — Centro Histórico (svc_008, service) — closest hit: Fred Cambios
- Cambios y Divisas Bocagrande (svc_009, service) — closest hit: Globo Cambio
- Titan Intercambio — San Diego (svc_010, service) — closest hit: None
- iFood Colombia (svc_014, service) — closest hit: Colombitalia Arepas
- Lavandería Express Getsemaní (svc_019, service) — closest hit: Lavanderia Laundry Vienesa Cartagena
- Lavandería La Burbuja — Centro (svc_021, service) — closest hit: Rainbow Laundry Cartagena - Lavandería
- Minimarket La Esquina — Getsemaní (svc_028, service) — closest hit: Calle Del Guerrero
- Beirut (ptr_dv3_009, restaurant) — closest hit: Harissa Bocagrande Cartagena
- El Charro (ptr_dv3_011, restaurant) — closest hit: Centro histórico
- Café Stepping Stone (ptr_occ_014, cafe) — closest hit: La Esquina del Pandebono
- Tu Rumba (ptr_occ_021, nightlife) — closest hit: Taboo Disco Club
- Bohaza (ptr_occ_022, cafe) — closest hit: Bozha CafeBar
- Multicambios — Centro Histórico (svc_ex_012, service) — closest hit: Money Exchange - Super Dollar
- Cambios Express — San Martín (Bocagrande) (svc_ex_015, service) — closest hit: CARTAGENA EXCHANGE
- Cambios del Caribe — Castillogrande (svc_ex_016, service) — closest hit: COMISIONES BARU
- Monumento a los Zapatos Viejos (attr_016, attraction) — closest hit: Las Botas Viejas
- Palacio de la Inquisición (attr_007, attraction) — closest hit: Museum of Cartagena de Indias
- Playa Scondida (ptr_X1236, hotel) — closest hit: None
- Makani Beach Club (ptr_W141, beach_club) — closest hit: Makani Luxury Cartagena
- Pao Pao Beach Club (ptr_W143, beach_club) — closest hit: PAO PAO Hotel & Restaurant
- Distrito (ptr_R084, restaurant) — closest hit: Cartagena
- Santoco (ptr_R126, restaurant) — closest hit: SANATOco - Un sano antojo
- Taco Beach (ptr_R082, restaurant) — closest hit: Tacobeach
- Bella Nails Bar (ptr_wn_006, beauty) — closest hit: MG Spa de Uñas Bocagrande
- Café del Pueblo (ptr_cf_003, cafe) — closest hit: Juan Valdez - Plaza San Diego
- Encolombiakitesurf (ptr_X1062, activity) — closest hit: In Colombia Kitesurf
- Sereno Spa Boutique (ptr_wn_009, wellness) — closest hit: Massage For Men Cartagena | Masajes Cartagena | Burano Spa Cartagena
- Bequia Eagle (ptr_dv2_001, yacht) — closest hit: Puerta No 4 - Muelle de La Bodeguita
- Juan Ballena (ptr_dv2_003, service) — closest hit: None
- Eco Hotel Islabela (ptr_dv_004, beach_club) — closest hit: Hotel Isla Bela en Islas del Rosario
- La Fantástica (barco pirata) (ptr_dv2_005, yacht) — closest hit: La Fantastica Cartagena Pirate Ship - Cartagena Sunset Skyline Bay Tours - Rosario Islands Day trips
- Gente de Mar Resort (ptr_dv2_006, beach_club) — closest hit: Rosario de Mar Ecohotel By Tequendama
- Oceanario Islas del Rosario (CEINER) (ptr_dv_006, attraction) — closest hit: Oceanarium Rosario Islands
- Sabai Beach Club (ptr_dv2_009, beach_club) — closest hit: Baru Playa Eco Beach Resort
- Members Only (MO) (ptr_dv_019, bar) — closest hit: Townhouse Cartagena | Boutique Art Hotel • Rooftop • Bar
- La Piccola Fattoria (ptr_dv2_021, restaurant) — closest hit: None
- OndadeMar (ptr_dv2_034, service) — closest hit: Sofitel Legend Santa Clara Cartagena
- Take a Chef (ptr_dv2_039, service) — closest hit: Cartagena Cooking School
- WEAT · Chef Andrés Ulloa (ptr_dv2_040, service) — closest hit: Weat The Caribbean Food Guide
- Savoya (ptr_dv2_045, service) — closest hit: Samaria Tours
- InDrive (ptr_dv2_046, service) — closest hit: None

## Landmarks without business status (4) — fine, no action
- Malagana (ptr_occ_005)
- Cerro de la Popa (attr_012)
- Islas del Rosario (attr_017)
- San Basilio de Palenque (tour) (ptr_dv2_041)

---

# ROUND 2 — Aug 25 2026: deep research on the TEMP + no-listing sets (web + TripAdvisor + directories + DIAN registry)

## REMOVED (16 more; total now 28) — soft-hidden, reversible with one command
Confirmed closed: Café Stepping Stone (Google), Boundless Mezcal Café (TripAdvisor
"permanently closed"), Moshi (TripAdvisor CLOSED), iFood Colombia (exited the country
Nov 2022). Strong-evidence closures: Beirut (TripAdvisor delisted), La Piccola Fattoria
(dormant since 2018), La Pepita Centro + La Diva Centro (dead branches; Bocagrande
siblings still operate — those stay). Zero-footprint ghosts: Tu Rumba, Café del Pueblo,
El Charro, La Parisienne, Casa Ritual, Bella Nails Bar, Sereno Spa Boutique, and
Titan Intercambio (absent from DIAN's authorized money-changer registry).

## FIXED (not removed)
- Bazurto Social Club — NOT closed: relocated 2024 to Casa Cruxada, Plaza Santo Domingo
  (Google pin was the abandoned Getsemaní address). Address updated.
- "Bohaza" → real name Bozha Café Bar (La Matuna) — renamed + address set.
- "InDriver Cartagena" → inDrive (2022 rebrand) — renamed. NOTE: ptr_dv2_046 "InDrive"
  looks like a duplicate listing — Franck may want to merge.

## VERIFIED OPERATING (leave as-is)
Norma, Kona, Members Only, Taco Beach (address is Calle Santo Domingo, not Bocagrande),
Makani, Pao Pao, Sabai (books as "Barú Playa Eco Beach Resort"), Eco Hotel Islabela,
Oceanario CEINER, Bequia Eagle, La Fantástica, Juan Ballena, En Colombia Kitesurf,
WEAT, Take a Chef, Savoya, Clínica Medihelp, Palacio de la Inquisición (Google name:
MUHCA), Monumento Zapatos Viejos, Distrito (operating as Distrito Tabaquero cigar
lounge — confirm it's the same place Franck means), Santoco (likely = SANATO.co in
Manga — name garbled, Franck to confirm), plus Yeyanails, BodyBrite Manga, Julis Pérez
spa, Playa Scondida, Gente de Mar, OndadeMar, La Burbuja, Lavandería Express.

## STILL UNVERIFIABLE — Franck's call (left live)
Badillo Comisiones (Google: temp closed) and the ~9 generic editorial service stubs
(Casa de Cambio Unidas, Cambios y Divisas Bocagrande, Multicambios, Cambios Express
San Martín, Cambios del Caribe, Scooter Rental Getsemaní, Golf Cart Rentals, Barbería
El Caribe, Pet Shop & Vet, Minimarket La Esquina) — generic names, unverifiable;
recommend replacing with real named businesses over time.
