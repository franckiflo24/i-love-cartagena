# Cómo un partner reclama su perfil en AMO Cartagena — Etapas

_Guía para Franck / equipo comercial. La parte de arriba se puede reenviar tal cual a los negocios._

---

## Para el negocio (mensaje reenviable)

**Reclamá tu negocio en AMO Cartagena en 4 pasos:**

1. **Encontrá tu negocio.** Buscá tu local en la app (Explorar o el buscador). Ya está en el catálogo — no hay que crearlo de cero.
2. **Tocá "¿Es tu negocio? Reclamalo"** en tu perfil. Si aún no tenés cuenta de negocio, la app te lleva a registrarte (gratis, 1 minuto).
3. **Verificá que sos el dueño.** Dos opciones:
   - **Por email:** te enviamos un código al correo que ya está registrado del negocio (vos no elegís a dónde llega — así protegemos tu perfil). Metés el código y listo. Necesitás tu **NIT**.
   - **Manual:** si no tenés acceso a ese correo, subís una prueba (foto del RUT, factura, redes verificadas) + NIT y nuestro equipo lo revisa.
4. **Activá y gestioná.** Ponés tu contraseña, aceptás términos, y ya controlás tu perfil: **fotos, horarios, eventos (agenda), promociones y reservas** — todo desde tu panel.

Una vez verificado, tus **eventos se publican al instante** (salvo que sean rechazados por el moderador). Aparecés en la Agenda, en las colecciones y en las recomendaciones de Luna (la IA).

---

## Para el equipo (referencia técnica)

Flujo ya construido y en vivo. Rutas:

| Etapa | Pantalla (frontend) | Endpoint (backend) |
|---|---|---|
| 1. Encontrar | `/business/find` · o CTA en `/partner/[id]` | `GET /business/catalog/search?q=` |
| 2. Reclamar | `/business/claim/[id]` | `POST /business/claim/start` (`method: email` \| `manual`, + `nit`) |
| 3. Verificar | `/business/claim/[id]` (paso `code` / `manual`) | `POST /business/claim/verify` (`claim_id`, `code`) |
| 4. Activar | `/business/activate` · o `/business/signup` / `/business/login` | `POST /business/activate` |
| 5. Gestionar | `/business/dashboard` (eventos, promos, stats, reservas) | `POST /business/events`, etc. |

**Seguridad (importante):** la verificación por email manda el código al correo **on-record** del venue — el que reclama nunca elige el destino. La opción manual pasa por revisión del equipo. `claim_status`: `unclaimed` → `pending_verification` → `verified_owner`. Un venue `verified_owner` oculta el CTA "¿Es tu negocio?".

**Descubribilidad (agregado Ago 2026):** antes el flujo existía pero no tenía entrada desde el perfil del propio negocio. Se agregó el botón **"¿Es tu negocio? Reclamalo"** en cada página de partner (`/partner/[id]`), que lleva directo a `/business/claim/[id]`.

**Caso Bethel Bellini:** es un venue editorial **sin reclamar**, por eso sus eventos "DJ al Atardecer" se sembraron por un endpoint admin (`POST /admin/seed-bethel-events`). Cuando Bethel reclame su perfil, su propio equipo gestionará los eventos desde el dashboard (publish-first) y ya no hará falta el seed.
