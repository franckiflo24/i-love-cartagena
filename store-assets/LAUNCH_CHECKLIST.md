# 🚀 Checklist de Lanzamiento — Amo Cartagena

> **Para Juliette** · Guía paso-a-paso para crear las cuentas externas que necesitas antes de subir la app a las tiendas.
> Total estimado: **~$140 USD el primer año** + **3-5 horas de tu tiempo** repartidas en 1 semana.

---

## 1️⃣ DOMINIO (10 minutos · ~$15 USD/año)

### Por qué primero
Todo lo demás depende de tener un dominio: el email de soporte, las URLs de privacidad que pide Apple/Google, los magic links de partners…

### Pasos

**Opción A — Cloudflare Registrar (RECOMENDADO, sin recargo)**
1. Entra a 👉 https://dash.cloudflare.com/sign-up
2. Crea cuenta (email + password)
3. Cuando estés logueada → **Domain Registration** → **Register Domains**
4. Busca `amocartagena.app` (o `amocartagena.com` / `.co`)
5. Cómpralo con tarjeta (≈$15 USD/año, sin renovaciones engañosas)

**Opción B — Namecheap (también buena, más popular)**
1. https://www.namecheap.com
2. Buscas el dominio → carrito → checkout
3. DESMARCA todos los add-ons (WhoisGuard ya viene gratis)

### Qué dominio recomiendo
| Opción | Pros | Contras |
|---|---|---|
| **`amocartagena.app`** ⭐ | Moderno, asocia con mobile app, .app fuerza HTTPS | $20/año |
| `amocartagena.com` | Reconocible universalmente | Más caro ($20-30) y puede estar tomado |
| `amocartagena.co` | Conexión con Colombia, corto | Disponibilidad limitada |

**Mi recomendación**: cómprate `amocartagena.app` y `amocartagena.co` (los 2 son baratos juntos ~$35/año), apuntas el `.co` al `.app`.

### Qué hacer cuando lo tengas
✏️ Pásame el dominio que compraste — yo actualizo:
- `PUBLIC_APP_URL` en `backend/.env`
- URLs de privacidad/términos/ayuda en app.json
- Activation magic links

---

## 2️⃣ EMAIL DE SOPORTE (30 minutos · GRATIS con Cloudflare)

### Opción GRATIS — Cloudflare Email Routing
Si compraste el dominio en Cloudflare:
1. Dashboard Cloudflare → tu dominio → **Email** → **Email Routing**
2. Click **Get started** → Cloudflare configura los DNS automáticamente
3. Crea redirección: `hola@amocartagena.app` → tu gmail personal (`juliette@gmail.com` por ejemplo)
4. Verifica el gmail (te llega un email de confirmación)
5. ✅ Listo: cuando alguien escriba a `hola@amocartagena.app` te llega a tu gmail

### Opción PRO — Google Workspace ($6 USD/mes)
Si quieres una bandeja de entrada real con `@amocartagena.app`:
1. https://workspace.google.com → Sign up
2. Verifica dominio (DNS TXT record)
3. Crea cuentas: `hola@`, `partners@`, `legal@`
4. Plan Business Starter = $6/mes/usuario

**Mi recomendación**: empieza con Cloudflare Email Routing (gratis). Cuando tengas tracción y volumen, pasas a Workspace.

### Emails que vas a necesitar
- `hola@amocartagena.app` — soporte usuarios (visible en tiendas)
- `partners@amocartagena.app` — onboarding partners
- `legal@amocartagena.app` — privacidad / términos (a futuro)

---

## 3️⃣ APPLE DEVELOPER PROGRAM ($99 USD/año · 1–7 días de aprobación)

### Importante decidir ANTES
**¿Te registras como persona natural o como empresa?**

| | Persona | Empresa (SAS) |
|---|---|---|
| **En la tienda aparece como** | "Juliette Saint-Cyr" | "Amo Cartagena S.A.S." |
| **Trámite** | Inmediato (~24h) | Requiere D-U-N-S Number gratis pero toma 1-2 semanas |
| **Responsabilidad legal** | Tuya personal | De la empresa |
| **Cobros App Store** | A tu cuenta | A cuenta empresa |

**Mi recomendación**: si vas a lanzar YA y tienes prisa → empieza como persona, después haces la transferencia a la SAS (Apple permite migrar pero es burocrático).

### Pasos (Persona)
1. Crea Apple ID en https://appleid.apple.com (si no tienes uno con tu correo de trabajo)
   - **Importante**: activa la **autenticación de dos factores**
2. Entra a 👉 https://developer.apple.com/programs/enroll/
3. Click "Start Your Enrollment"
4. Login con tu Apple ID
5. Selecciona **Individual / Sole Proprietor**
6. Completa datos:
   - Nombre legal completo
   - Dirección
   - Teléfono
   - Tarjeta de crédito ($99 USD)
7. Acepta acuerdos → paga
8. Aprobación: **24h - 7 días**

### Pasos (Empresa SAS)
1. **Primero**: pide D-U-N-S Number gratis aquí 👉 https://www.dnb.com/duns-number/get-a-duns.html (forma "Free D-U-N-S Number Request")
   - Tarda 5-15 días hábiles
   - Necesitas el NIT de tu SAS
2. Luego sigue el flujo "Organization" en `developer.apple.com/programs/enroll/`
3. Apple verificará por teléfono que eres autorizada legalmente de la SAS

### Lo que necesito de ti cuando esté aprobado
- ✏️ **Team ID** (lo encuentras en https://developer.apple.com/account → arriba a la derecha bajo tu nombre)
- ✏️ **App Store Connect access** — me invitas como `admin` para subir el build (opcional, también podemos exportar `.ipa` y tú lo subes)

---

## 4️⃣ GOOGLE PLAY CONSOLE ($25 USD una vez · 1–2 días)

### Pasos
1. Necesitas una **cuenta Google** (puede ser tu Gmail personal, NO el `@amocartagena.app` todavía porque aún no existe el dominio)
2. Entra a 👉 https://play.google.com/console/signup
3. Selecciona **Personal** o **Organization** (mismo criterio que Apple: empresa requiere verificación adicional)
4. Acepta el Developer Distribution Agreement
5. Paga **$25 USD una sola vez** con tarjeta
6. Verifica tu identidad subiendo:
   - 📄 Foto de tu cédula / pasaporte (formato JPG/PNG)
   - 📄 Comprobante de domicilio (factura de servicios último mes, en PDF/JPG)
7. Aprobación: **1-2 días hábiles**

### Lo que necesito cuando esté aprobado
- ✏️ Email de tu cuenta Play Console (para invitarte como Admin del proyecto Emergent)
- ✏️ O alternativamente: el `.aab` lo exportamos y tú lo subes

---

## 5️⃣ WOMPI SANDBOX (30 minutos · GRATIS)

### Pasos
1. Entra a 👉 https://comercios.wompi.co
2. Regístrate con email + password (NO necesitas datos bancarios para sandbox)
3. Una vez dentro: **Desarrolladores** → **Llaves API**
4. Busca la sección **"Pruebas / Sandbox"**
5. Copia los 4 valores que aparecen:
   ```
   Llave pública sandbox:    pub_test_xxxxxxxxxx
   Llave privada sandbox:    prv_test_xxxxxxxxxx
   Integrity secret:         test_integrity_xxxxxx
   Events secret:            test_events_xxxxxx (opcional sandbox)
   ```
6. Pásame los 4 valores → yo los configuro en `backend/.env`

### Bonus: para Producción (cuando termines de probar)
- Necesitarás validar identidad de la empresa + cuenta bancaria
- Wompi tarda 5-10 días en aprobar comercios reales
- Recibirás llaves `pub_prod_` y `prv_prod_`

---

## 6️⃣ FACTURACIÓN DIAN (Colombia · opcional pero recomendado)

Como vas a recibir pagos:

1. **NIT como SAS** o régimen simple persona natural → permite emitir facturas electrónicas
2. **Cuenta bancaria empresarial** (Bancolombia, Davivienda) — donde Wompi te liquidará
3. **Software de facturación** (Siigo, Alegra, ContaPyme) — Wompi se integra
4. **Asesor contable** — te recomiendo uno fijo desde el día 1 para no tener líos con DIAN

> ⚠️ **No bloquea el lanzamiento técnico** pero sí necesitas tener esto en orden antes de recibir tu primer pago real.

---

## 📋 RESUMEN — Qué necesito de ti en orden

```
□ Día 1   (hoy)        → Compra dominio en Cloudflare/Namecheap
□ Día 1   (hoy)        → Configura email gratis con Cloudflare Email Routing
□ Día 1   (hoy)        → Saca llaves Wompi sandbox (30 min)
□ Día 2-3 →             → Crea Apple Developer Program ($99)
□ Día 2-3 →             → Crea Google Play Console ($25)
□ Día 4-5 →             → Esperas aprobación
□ Día 6   (cuando aprueben) → Me pasas dominio + llaves Wompi + IDs Apple/Google
□ Día 7   (yo)          → Configuro todo + corro testing_agent final
□ Día 8   (botón Publish) → Generamos builds IPA + AAB
□ Día 9-10 →             → Tú pruebas el build en tu iPhone/Android (TestFlight + Internal Track)
□ Día 11  →             → Submit a Apple + Google
□ Día 13-18 →            → 🎉 APP EN VIVO
```

### Inversión total
| Concepto | Costo |
|---|---|
| Dominio `amocartagena.app` | $15 USD/año |
| Apple Developer | $99 USD/año |
| Google Play Console | $25 USD una vez |
| Wompi | $0 (cobra comisión por transacción) |
| Email (Cloudflare gratis) | $0 |
| **TOTAL primer año** | **$139 USD** |

---

## 📨 La info exacta que necesito de ti después

Cuando hayas hecho lo de arriba, mándame este bloque por chat:

```
🌐 DOMINIO COMPRADO: _____________________
📧 EMAIL SOPORTE: _____________________ (ej: hola@tudominio.app)

🍎 APPLE DEVELOPER
   Team ID: _____________________
   Apple ID (email): _____________________
   ¿Persona o Empresa?: _____________________

🤖 GOOGLE PLAY CONSOLE
   Email de cuenta: _____________________
   ¿Persona o Empresa?: _____________________

💳 WOMPI SANDBOX
   WOMPI_PUBLIC_KEY=pub_test_______________
   WOMPI_PRIVATE_KEY=prv_test_______________
   WOMPI_INTEGRITY_SECRET=test_______________
   WOMPI_EVENTS_SECRET=test_______________
```

Con eso configuro el `.env` definitivo, ajusto todas las URLs en la app, corro el `testing_agent` integral y te dejo lista para apretar **Publish**. 🚀

---

## ❓ Preguntas frecuentes

**¿Y si no compro dominio ahora?**
> Puedes lanzar al principio con la URL del preview (`cartagena-live.preview.emergentagent.com`), pero NO se ve profesional en App Store y los partners van a desconfiar. **Compra el dominio sí o sí antes de submit.**

**¿Cuánto se demora la revisión Apple?**
> Primera revisión: **3-7 días** (suelen rechazar 1-2 veces por detalles). Versiones futuras: **1-2 días**.

**¿Y si Apple rechaza?**
> Yo te ayudo a responder. Lo más común que rechazan: privacy policy incompleta, descripción muy genérica, screenshots con texto incorrecto. Ya tenemos todo eso resuelto.

**¿Puedo usar mi Apple ID personal?**
> Sí. Pero te recomiendo crear UNO NUEVO con `juliette@amocartagena.app` cuando tengas el dominio, así separas vida personal de negocio.

**¿Tengo que pagar IVA al comprar en Apple/Google?**
> Apple cobra IVA según país. Google también. Para Colombia es ~19% extra. Presupuesta ~$170 USD el primer año en vez de $139.

---

> **¿Dudas en algún paso?** Mándame screenshot del error o del paso donde te trabas y te ayudo. No te avances sin estar segura — un error en Apple Developer puede congelar tu cuenta 30 días.
