# City hub ("Moverse") — source research, September 2026

Source document for `frontend/public/data/city/modules.json` and Luna's `city_modules` knowledge.
Two parts: (A) the module spec, (B) the underlying research on Cartagena's transport, tourist-transport
and monument payment systems. Facts marked "uncertain" in (B) must ship with confidence VERIFY.

---

## (A) The "City" section — module architecture

Container: a single "Cartagena" / "Moverse" hub (one tab or one home-screen section), holding six cards. This keeps it clean — one entry point, not six scattered features. Each card has: title, icon, one-line description, verified info, official source link, and a status badge.

Status badges (the honesty system — every card wears one):
- Info — we show accurate info; you act off-app (most cards, now)
- Próximamente — booking/payment coming to AMO
- En vivo — actually transactable in AMO (none yet; earned only with a signed agreement)

MODULE 1 — Transcaribe (Bus) · badge: Info
Content: how the system works, the COP 3,900 fare, the tarjeta Transcaribe, where to recharge (Punto de Pago, SuperGiros app, PSE), and that Visa contactless works at validators. Route map (static, from Transcaribe).
Honest note in-card: "Pay with your tarjeta Transcaribe or Visa contactless." AMO informs; doesn't sell (SONDA holds the concession).
Luna training: fare, recharge options, Visa contactless = yes. She does not say AMO sells bus tickets.

MODULE 2 — Muelle La Bodeguita / Island Boats · badge: Info → Próximamente
The strongest card. Content: the real all-in cost — COP 18,000 pier + COP 13,500 park + COP 8,800 insurance = ~40,300/person on top of the tour, paid cash at the taquillas. This is pure trust-brand gold: nobody else shows the true number that ambushes tourists.
"Book from La Bodeguita only" safety line (authorized muelle).
This is the card most likely to earn a real Corpoturismo agreement later → then flip to Próximamente/En vivo.

MODULE 3 — City Pass / Monuments · badge: Info
Content: Castillo San Felipe (COP 33,000 nationals, sold online by ETCAR), Palacio de la Inquisición/MUHCA, Las Bóvedas (free), the walls (free). Each with what it is, price, and the official ticket link.
No fake "buy" — link out to ETCAR's real online ticketing for now.

MODULE 4 — Electric Carriages · badge: Info → best early Próximamente candidate
Content: the 60 electric carriages (Asociación de Cocheros), the fares (30 min / 1 hr, seasonal), stops (Baluarte Santo Domingo, La Serrezuela), hours 9am–11pm, pay by cash or card POS. Frame it as the beautiful modern replacement for the horse carriages — great visual story.
Honest note: this is the lowest-barrier real integration (private association, commercial POS, no concession) — so its card is built to become bookable first.

MODULE 5 — Water Taxis (Transcaribe Acuático) · badge: Próximamente
Content: the announced pilot (Dec 2026, four stations: Bocagrande, La Bodeguita, Bazurto, Pasacaballos), solar acuabuses, Pasacaballos–Bocagrande in ~15 min. Frame as "coming to Cartagena."
Honest: this is a future city project, not live — so Próximamente is truthful. Do NOT imply AMO runs it.

MODULE 6 — Taxis · badge: Info
Content: the official DATT zone fares (airport→Centro ≈ COP 20,200, etc.), "no meters, confirm the zone price first," report overcharging via Titán Chat 304 251 1127. The anti-scam framing again.

What each module needs (build checklist — nothing missed)
For every card: verified data (from the research, with source URL + "last verified" date), an image, the status badge, Luna facts, and a fallback ("for the latest, check [official source]").

On images — the honest catch: pull them the right way. Your own photos of Cartagena, official/licensed images, or properly-licensed stock. Do not scrape random web images (copyright risk) and do not use AI-generated images of real monuments/systems that could misrepresent them. For a city-official-aspirant app, image provenance matters — one stolen photo undercuts the "official" positioning.

Training Luna (retrieval, not fine-tuning — same as before)
Feed Luna a structured knowledge file (one entry per module) with: the verified fact, the source, the status, and an explicit "AMO does not yet sell this — direct to [official]" flag where true. Then she answers "how much is the bus / what's the real island cost / can I buy a city pass in AMO" accurately, and declines honestly where AMO can't transact. Same architecture that made the venue retrieval work. She becomes the city's honest guide — which, notably, is exactly what the official "Visit Cartagena" app's chatbot tries to be, and yours can be better and accurate.

---

## (B) Cartagena's Transport, Tourist-Transport and Monument Payment Systems: Can a Private App Become the QR/Payment Layer?

A private app cannot become the payment layer for Cartagena's most valuable systems by building its own rails. Transcaribe's fare collection is contractually held by SONDA S.A., which just switched on Visa contactless payments. The monuments and the pier each sell through their own ticketing. The realistic path is to become a reseller/aggregator partner of each controlling entity, one at a time. The fastest wins are the electric carriages and the monument/pier ticketing, not the BRT.

### TL;DR
- **Transcaribe is the hardest target.** Fare collection has been contracted to SONDA S.A. since Aug 2023 (contract TC-SO-001-2023, COP 27,713,405,954.34 per Transcaribe's Otrosí No. 4 justification, 3-year operational phase). Open-loop Visa contactless (MTT standard) launched in Aug 2026 under that contract. A third-party app can realistically only be a top-up/recharge channel (like SuperGiros or Punto de Pago), not the validator-level QR layer, unless Transcaribe amends SONDA's contract or tenders a new long-term recaudo concession. That concession was promised but has not been seen opened.
- **The tourist systems are more open but fragmented.** Corpoturismo (a private-law mixed corporation) runs Muelle La Bodeguita. It collects a COP 18,000 pier fee at taquillas, while Parques Nacionales collects its own COP 13,500 park fee (also via an online payment link) and insurers sell the mandatory policy. The Escuela Taller Cartagena de Indias (ETCAR) sells Castillo San Felipe tickets online and at the booth (COP 33,000 nationals, 2026). The 60 electric carriages are operated by the Asociación de Cocheros with Distrito-supplied POS/datáfono and GPS. No official combined "city pass" was found.
- **Procurement is the gating factor.** Any paid contract with a public entity above the "menor cuantía" threshold defaults to licitación pública on SECOP II, which realistically takes about 2–4 months after months of structuring. Mixed or private-law entities (Corpoturismo, Transcaribe in its "rol operador") use their own manuals. The city already has an official tourism app, "Visit Cartagena" (MinTIC/Cámara de Comercio/Alcaldía, COP 4,500 million per MinTIC), which a newcomer must compete with or plug into.

### Key Findings

| System | Controlling entity | How people pay today | Existing payment vendor/concession | Modernization announced | Realistic entry path |
|---|---|---|---|---|---|
| Transcaribe BRT | Transcaribe S.A. (company of district public entities) plus Alcaldía (sets fare by decree) | Tarjeta Transcaribe (account-based), recharge at Punto de Pago, SuperGiros (outlets + app), PSE on the website; Visa contactless since Aug 2026 | **Yes – SONDA S.A.** (recaudo, fleet control, user information) | Visa MTT open payments; other card brands after 3 months; QR "planned" since 2023 | Recharge-channel alliance, or wait for the new concession tender |
| Water transport (Transcaribe Acuático) | Transcaribe S.A. / Alcaldía, with UK C40-CFF and GIZ support | Not yet operating | None announced | Pilot slated for Dec 2026: 4 stations, 50-passenger solar "acuabuses" | Likely folded into the Transcaribe/SONDA recaudo; watch the tender |
| Muelle La Bodeguita | Corpoturismo (administrator), Secretaría de Turismo, DIMAR (maritime authority/zarpes) | Pier fee COP 18,000 at taquillas; PNN fee COP 13,500 at the pier or via the PNN online link; insurance paid to insurers | Not identified (in-house taquillas) | No pier-fee digitization announced; PNN added virtual payment | Partnership with Corpoturismo (private-law contracting) and PNN |
| Electric carriages | Distrito (owns vehicles), DATT/Corpoturismo (routes, control), Asociación de Cocheros (operator) | Pay the cochero in cash or card via POS; e-invoice | POS + telemetry via Simplificar S.A.S. (GPS); POS provider not named | Already digitized (June 2026) | Booking/marketplace partnership with the Asociación; lowest barrier |
| Monuments | ETCAR (fortifications, under Ministerio de las Culturas Comodato No. 2628 of 2024); Corporación MUHCA (Palacio de la Inquisición, Alcaldía/IPCC) | Castillo: online + booth; MUHCA: booth (online not verified) | ETCAR has its own online ticketing | None for a city pass | Reseller agreements with each administrator |
| Taxis | DATT / Alcaldía (zonal tariff decree) | Cash, fixed zone fares, no taximeters | None (private owners/companies) | None found | Hailing/payment apps operate privately; no official layer |

### Details

#### 1. Transcaribe (BRT)

**(a) Ownership and control.** Transcaribe S.A. is a "Sociedad Anónima entre entidades públicas del orden Distrital, constituida con aportes públicos." The Concejo Distrital authorized it through Acuerdo N° 004 of 19 Feb 2003, as recited in the SONDA contract. The exact shareholding split between the Distrito and its decentralized entities was **not verified**. The Alcaldía sets the user fare by decree. The fleet is run by three operators: Sotramac, Transambiental and "Transcaribe Operador," the district-controlled portion. General manager in 2026: Ercilia Barrios Flórez.

**(b) How payment works today.**
- **Card:** the tarjeta Transcaribe, now on an **account-based ticketing (ABT)** system. The balance sits in a central account, not on the chip. Transcaribe calls itself the first Colombian mass-transit system to run ABT.
- **Recharge:** at 97+ Punto de Pago outlets (Dec 2023; target 400+), more than 1,000 SuperGiros points in Cartagena (2,000+ in Bolívar), the SuperGiros app (from July 2025), and PSE on Transcaribe's website (minimum COP 10,000). A "Portal del Usuario" handles balance checks, card blocking and complaints.
- **Visa contactless:** since late August 2026, riders can pay directly at validators with Visa credit, debit or prepaid cards (domestic or foreign) and NFC wallets under Visa's MTT standard. Visa Colombia general manager Adriana Cárdenas, quoted by El Nuevo Siglo, said "Durante tres meses los pagos serán exclusivos Visa," after which it will open to the rest of the ecosystem.
- **Fare:** **COP 3,900** since 23 Jan 2026 (Decreto 017 of 15 Jan 2026). That is up from COP 3,400 in 2025 and is the highest mass-transit fare in Colombia.
- **Subsidy:** a COP 1,000 subsidized differential fare (Decreto 0176 of 19 May 2026) is loaded onto registered cards for about 27,000 beneficiaries.

**Ridership – the "~500,000/day" figure is false.** At its 10-year anniversary (Nov 2025), Transcaribe reported demand of **100,000–114,000 users per working day**. The Wikipedia figure of 150,000 (Aug 2024) is poorly sourced. DANE reported the steepest drop in the country for Transcaribe in Q1 2026: –14.7% versus Q4 2025 and **–26.7% year on year**. The El Universal report of May 2026 confirms a decline in 2025. Treat about 100,000 per working day as the realistic order of magnitude.

**(c) Is fare collection concessioned? Yes, contractually locked.**
- **History:** the original concession (Consorcio Colcard, contract TC-LPN-005-2010, running from 2016 to 2034) collapsed. Colcard member Dataprom switched off the system on 1 Mar 2023, forcing cash paper tickets. The contract was terminated bilaterally on 12 Mar 2023.
- **How SONDA was chosen:** Transcaribe took over recaudo directly "in its role as recaudador" and subcontracted it through a **solicitud de oferta** under its own operator contracting manual. Ten firms were invited, with a proof of concept.
- **The SONDA contract:** SONDA S.A. (Chilean, Colombian branch) signed "Contrato de Prestación de Servicios de Recaudo, Gestión y Control de Flota e Información al Usuario" on **17 Aug 2023**, with an acta de inicio on 5 Sep 2023. Transcaribe's Otrosí No. 4 justification document states the estimated value as **COP 27,713,405,954.34**, and records that Otrosí No. 2 "modificó la cláusula décima séptima relativa al plazo del contrato," so the term has already been amended once. Term: 3-month pre-operational stage, **3-year operational stage**, and a 5-month transition stage. SONDA took over the validators on 8 Dec 2023.
- **Estimated end date (inference, not confirmed):** the operational phase would end around **Dec 2026**, and the transition around **May 2027**.
- **Otrosí No. 4:** exists, and its justification document covers EMV contactless, NFC and PCI-DSS requirements. It appears to be the contractual vehicle for open payments. Its date, value and any term extension could not be read.
- **Long-term concession not yet visible:** in 2023 Transcaribe's legal chief said the transitional operator would serve "máximo dos años" while a licitación pública for a roughly 20-year concession was structured. **No such recaudo tender was found as of Sept 2026.**
- **Acquirer unknown:** the acquirer/aggregator for the Visa rollout is **not publicly identified**. Credibanco does this for TransMilenio and MIO, but that is unconfirmed for Cartagena.

**(d) Modernization.** Since Dec 2023, Transcaribe has promised recharge via bank apps and digital wallets, **QR codes**, and debit/credit at validators, plus a new user app. Of these, bank-card contactless (Visa first) is now live. SuperGiros app recharge is live. QR payment at validators and a dedicated Transcaribe app were **not confirmed** as launched. The mayor branded 2026 "the year of Transcaribe's modernization": 55 new buses from May 2026, open payments, and the water pilot.

**(e) Path for a third-party app.**
- The validators, the central account system and the payment-media rules all sit inside SONDA's contract with Transcaribe. A private app cannot put its own QR on validators without (i) Transcaribe and SONDA agreeing to integrate it (likely through another otrosí and technical certification), or (ii) winning or partnering in the future long-term recaudo concession.
- **Realistic near-term entry:** become a **recharge channel**. SuperGiros and Punto de Pago were onboarded by direct contracts (TC-DC-003-2024; TC-CD-004-2023, extended to 7 June 2026). Note that, per Transcaribe's análisis preliminar for TC-DC-003-2024, Transcaribe pays SONDA "el diez por ciento (10%) del valor pagado al CONTRATISTA, por ser integrador tecnológico de recaudo," on top of a 2.8% recharge commission.
- **Medium term:** position for the concession tender. That is likely a licitación pública, with SONDA as the incumbent.
- **Risk:** open-loop bank-card payments reduce the value of any closed QR wallet, especially for tourists.

#### 2. Water taxis / "Transcaribe Acuático"

- **(a) Who is behind it:** a real, officially announced project, run by **Transcaribe S.A. and the Alcaldía** (Mayor Dumek Turbay). It is included in the 2024–2027 Development Plan.
- **Support:** technical support comes from the UK-backed **C40 Cities Finance Facility**, and a GIZ-contracted technical study was underway in 2025.
- **DIMAR's role:** it would be the maritime authority for navigation permits. No DIMAR announcement specific to this project was found.
- **Private operator:** none identified.
- **Timeline history:** the pilot has slipped repeatedly.
  - It was first announced for Dec 2025, with 1 station and 2 air-conditioned boats for 40+ passengers.
  - An April 2026 report had four boats under construction for a November pilot.
  - The latest official line, from Mayor Dumek Turbay as reported by Infobae (10 Sep 2026) and El Tiempo, is a pilot in **December 2026** with four stations: Bocagrande, Muelle La Bodeguita, Bazurto and Pasacaballos. It aims to cut a Pasacaballos–Bocagrande trip of "cerca de dos horas" by road to "unos 15 minutos" by water, using solar-powered, climatized "acuabuses" of about 50 passengers. However, in a letter dated 28 May 2026, Transcaribe told a citizen that "Aún no se ha iniciado una etapa de estructuración" (Pluralidad Z).
  - Full operation is projected for 2027.
- **Tierra Bomba:** it appears in the broader "hidrovía" network (with Albornoz and Punta Arena) but not in the first pilot stations.
- **(b) How payment will work:** **not announced.** Since it is to be "integrated into Transcaribe," the default expectation is the Transcaribe ABT card and SONDA's validators. That is an inference.
- **Existing informal service:** boat transport to Tierra Bomba today is informal or private lancha service. No formal scheduled boat-taxi concession was found.
- **(e) Path:** the pilot is the window. Approach Transcaribe and the C40/GIZ structuring team now, while the operating and payment model is still being designed. Expect that any permanent operation will be tendered.

#### 3. Muelle La Bodeguita fees

- **(a) Authority over the pier:** **Corpoturismo** (Corporación Turismo Cartagena de Indias) is officially the "entidad administradora del Muelle de La Bodeguita." It works under the Alcaldía's Secretaría de Turismo and alongside DIMAR (which authorizes departures, or zarpes) and the Tourism Police.
- **Scale:** Corpoturismo projected more than 21,000 passengers and about 520 departures over Holy Week 2026.
- **Legal nature:** Corpoturismo is a non-profit mixed civil corporation **governed by private law**, per its statutes. It contracted the pier repairs by "licitación privada" (2023, about COP 2,109 million).
- **(b) The three charges and how each is paid:**
  - **Pier-use fee:** **COP 18,000**, collected by Corpoturismo at the pier taquillas (El Universal, Jul 2026).
  - **Parque Nacional Natural Corales del Rosario y San Bernardo entry fee:** **COP 13,500** in 2026 (COP 11,000 for the San Bernardo sector). Parques Nacionales Naturales (PNN) collects it. It can be paid **at the pier or through a payment link on the PNN website**. PNN described this as "strengthened collection mechanisms… and virtual payment options."
  - **Mandatory accident/assistance insurance:** introduced by PNN on 7 Jan 2026. It is **paid to authorized insurers, not to PNN**.
- **(c) Vendors:** no technology vendor holding a collection concession was identified for the pier fee.
- **Leakage:** unauthorized departures from other points bypass both fees, which is a recaudo problem the authorities are publicly worried about.
- **(d) Digitization:** PNN has a virtual payment channel. No pier-fee digitization project was found (**uncertain**).
- **(e) Path:**
  - A bundled "island departure" checkout (pier fee + PNN fee + insurance) is a genuine user pain point.
  - It would require three separate agreements: Corpoturismo (private-law contracting, so faster and more flexible than a public tender), PNN (a national entity under public procurement rules), and a licensed insurer.
  - Expect resistance from lancheros, who have demanded a say in pier decisions.

#### 4. Electric carriages (replacing horse carriages)

- **Program:** the Alcaldía's **Sistema Integral de Transporte Turístico y Sostenible (SITTS)** replaced horse-drawn coches with **62 electric carriages** built in Henan, China. El Tiempo reported about COP 7,000 million as the total system cost, but the Alcaldía (12 Jun 2026) ties that figure to the Patio Taller Chambacú charging depot alone ("tras una inversión por el orden de los $7.000 millones"), so the total system cost is unconfirmed.
- **Rollout:**
  - The first 24 were presented in Nov 2025.
  - Free pilot rides ran from 30 Dec 2025. More than 2,000 riders took part in the first pilot, and more than 20,000 by June.
  - Horse-drawn carriages are now banned by Decreto 2296, in force since 29 Dec 2025, per the Alcaldía, and the 120 horses were adopted out through UMATA.
- **Operation:** on **12 June 2026** the mayor handed over the keys to **60 carriages**, operated by the **Asociación de Cocheros de Cartagena**. This benefits more than 150 families. The Distrito keeps 2 units.
- **Infrastructure:** a solar charging depot at Chambacú (244 panels), built by the Secretaría de Infraestructura with Edurbe managing.
- **Pricing:** fares are set by the association and reported to the DATT. Reported fares: 30-minute ride COP 170,000 / 1-hour ride COP 300,000 in low season; COP 200,000 / 350,000 in high season. Private or event hire starts at COP 300,000/hour.
- **Hours and control:** 9 a.m.–11 p.m., from designated stops (Baluarte Santo Domingo, La Serrezuela, and others). DATT and Corpoturismo control the routes.
- **Payment:** the carriages now carry a **POS/datáfono** with three fare modes: circular route, origin–destination, and time-based rental. Each ride produces a receipt or electronic invoice.
  - **Simplificar S.A.S.** provides GPS telemetry and geofencing.
  - Zello push-to-talk runs on 4G devices.
  - The official Alcaldía page says: pay "directly with the cochero, in cash or by card."
- **Path:** this is the **lowest-barrier opportunity**. The operator is a private association and the payment rail is a commercial POS, not a concession.
  - A booking/pre-payment or QR-at-carriage deal needs the Asociación's agreement.
  - It also needs alignment with DATT/Corpoturismo on official tariffs and the e-invoicing already in place.
  - Uncertain: who owns the POS contract and whether it has exclusivity.

#### 5. Monuments / city pass

- **Castillo San Felipe de Barajas and the fortifications (including the walls and Baluarte de Santo Domingo; Bocachica forts):**
  - **Who controls them:** administered by the **Escuela Taller Cartagena de Indias (ETCAR)** under **Comodato No. 2628 of 17 May 2024 with the Ministerio de las Culturas, las Artes y los Saberes** (as recited in ETCAR Resolución 005 of 9 Jan 2026), not ICANH. They are Bienes de Interés Cultural of the Nation. ETCAR's operation is self-funded from ticket revenue.
  - **Price:** 2026 fees set by ETCAR Resolución 005 of 9 Jan 2026. The national rate is **COP 33,000**. The foreign-visitor rate was not retrieved and should be checked on ETCAR's site.
  - **Ticketing:** ETCAR has sold **online tickets since Aug 2018** (card payment, e-mailed code), alongside the booth, with turnstiles and anti-counterfeit tickets.
  - **Walls:** walking the walls is generally free. Specific spaces are rented or exploited commercially.
- **Palacio de la Inquisición / Museo Histórico de Cartagena (MUHCA):**
  - **Who controls it:** the **Corporación Museo Histórico de Cartagena de Indias**, a non-profit created by Acuerdo 009 de 2010. Its board includes the Alcaldía, IPCC, the Secretaría de Educación, the Universidad de Cartagena and Corpoturismo.
  - **Price:** secondary sources cite about **COP 22,000** for adults, date **unverified**.
  - **Ticketing:** booth sales; online ticketing **not verified**.
- **Las Bóvedas:** a commercial arcade of craft shops with free entry. Its administrator was **not verified** in this research.
- **Other museums:** Museo Naval, Museo del Oro Zenú (Banco de la República) and others each have separate administrators. They were not researched individually.
- **City pass:** **no official combined pass was found.** Corpoturismo promotes the museums but sells no bundle. (Many search hits for a "Cartagena pass" refer to Cartagena, Spain.)
- **Path:** negotiate reseller/API agreements, starting with **ETCAR** (highest volume, already online, self-funded, so it has an incentive) and then MUHCA. Either can contract under its own regime. ETCAR operates a ministry comodato, so check the comodato terms for resale clauses. Corpoturismo is the natural convener for a bundled pass.

#### 6. Taxis

- **Who sets tariffs:** the **DATT** (Departamento Administrativo de Tránsito y Transporte) by district decree. The latest found is **Decreto 0765 of 17 Mar 2025**, which sets zone-based fares from six origins: Centro Histórico, airport, bus terminal, Bocagrande, Bazurto and the **Muelle Turístico**. The 2024 decree set the minimum fare at COP 9,800 plus a COP 900 night surcharge.
- **2026 fares:** not verified.
- **Payment:** there are **no taximeters**, so fares are fixed by zone and paid in cash, and overcharging tourists is a recurring enforcement issue.
- **Digital:** no official DATT app or digital-payment initiative for taxis was found. Private ride-hailing and taxi apps operate commercially. The Visit Cartagena app's "suggested prices" function is the only official anti-overcharging tool found.
- **Path:** there is no concession to displace. A private app can sign up taxi companies directly. Official status, such as a DATT-endorsed fare calculator, would require an agreement with the DATT.

#### Procurement: how a vendor gets in

- **The modalities (Ley 80 de 1993 and Ley 1150 de 2007, art. 2):**
  - **Licitación pública** is the default. It is mandatory unless another modality applies.
  - **Selección abreviada:** menor cuantía, uniform goods, or after a declared-void tender.
  - **Concurso de méritos:** consultancy only.
  - **Contratación directa:** a closed list, including interadministrative agreements, sole provider, science and technology, and professional services.
  - **Mínima cuantía:** up to 10% of menor cuantía.
- **What that means for a platform:** a paid technology/payment contract above menor cuantía with no direct-contracting ground goes to licitación.
- **The SECOP II steps (Decreto 1082 de 2015):** estudios previos; aviso de convocatoria; draft pliego (10 business days for comments in a licitación, 5 in selección abreviada); resolución de apertura; risk-allocation hearing; addenda no later than 3 days before closing; evaluation report published ~5 business days; public award hearing.
- **Timing:** realistically about **2–4 months** for a licitación and 1–2 months for a selección abreviada de menor cuantía, plus the preceding structuring time. This timeline estimate is legal knowledge, not an official figure.
- **Recent change:** Decreto 997 de 2026 amended Decreto 1082, phasing in rules on sustainability and anti-corruption clauses.
- **Special regimes:** mixed and state companies competing with the private sector can contract under private law (Ley 1150 art. 14, modified by Ley 1474 art. 93); Transcaribe runs ordinary purchases under Ley 80 and recaudo/operation under its own "Rol Operador" manual (Resolución 137 de 2015); Corpoturismo contracts under private law but is bound by public-resource controls.
- **Unsolicited proposals:** Ley 1508 de 2012 (APP de iniciativa privada without public funds, art. 19) allows a private proposal to be developed and then published on SECOP for 1–6 months; APPs target infrastructure and require a minimum of 6,000 SMMLV, which likely excludes a pure app.
- **Zero-cost deals:** revenue-share or "zero-cost" arrangements are not automatically exempt. Seek a Colombia Compra Eficiente concept.

#### Is there already an "official city app" or smart-city platform?

- **Visit Cartagena:** yes, **"Visit Cartagena" (VisitCartagena.com.co) and its mobile app**, launched as "Conecta Cartagena." Built by MinTIC, the Cámara de Comercio de Cartagena, the Gobernación de Bolívar and the Alcaldía. A MinTIC press release states "El proyecto tuvo una inversión de $4.500 millones". Features: suggested-price verification against tourist overcharging, itineraries and an AI chatbot; described as a beta. It was not found to process payments.
- **Other channels:** Corpoturismo runs the destination portal cartagenadeindias.travel. No city-wide digital-payment platform or single payments vendor was found.
- **Implication:** the strongest "official platform" position is already taken by a MinTIC-funded app without payments. Integrating with Visit Cartagena as its transactional layer may be more feasible than displacing it.

### Recommendations

1. **Start where there is no concession:** electric carriages (Asociación de Cocheros plus Corpoturismo/DATT); ETCAR monument tickets; a bundled Bodeguita departure checkout (Corpoturismo, PNN, insurers). These can be contracted by partnership or reseller agreements without a public tender.
2. **For Transcaribe, apply for a recharge-channel alliance now** (the SuperGiros/Punto de Pago model), and prepare to bid or partner in the long-term recaudo concession tender. Do not build a validator QR strategy that assumes access without SONDA.
3. **Engage the Transcaribe Acuático structuring team (Transcaribe, C40-CFF, GIZ) before the December 2026 pilot**, while the payment model is still open.
4. **Approach Corpoturismo as the convener of a city pass.**
5. **Explore plugging into Visit Cartagena** as a payment/booking provider rather than competing as "the official app."

### Caveats

- **Verified:** SONDA contract date, value and phase structure; the COP 3,900 fare; Visa MTT launch and three-month Visa exclusivity; the 100–114k per working day ridership (official, Nov 2025); Corpoturismo as pier administrator and the COP 18,000 pier fee; PNN COP 13,500 fee and the insurance requirement; ETCAR control, online ticketing and COP 33,000 national rate; electric carriage handover and POS; DATT zonal tariff decrees; Visit Cartagena.
- **Uncertain:** SONDA's exact end date and whether Otrosí 4 extended it; the Visa acquirer; whether QR payment at validators is live; Transcaribe's exact shareholding; water-pilot payment model and dates (it has already slipped twice); carriage fares (reported by Alerta; association-set, seasonal); Palacio de la Inquisición price and online sales; Las Bóvedas administrator; 2026 taxi tariffs; Castillo foreign-visitor price.
- Procurement timelines are estimates, not statutory totals.
- Transcaribe's own website blocks automated access, so several contract details rely on search snippets of its official documents. (Runtime check 2026-09-26: all 18 transcaribe.gov.co URLs in the module data returned 200 to curl and headless Chrome.)

### Link audit notes (2026-09-26, `scripts/audit-city-links.py`)

- **transitocartagena.gov.co (DATT) = CloudFront country block.** curl and headless Chrome from a US egress get 403 "The Amazon CloudFront distribution is configured to block access from your country" (pop MIA50). This is a geo-block, not a bot wall: a tourist on a roaming SIM whose traffic is home-routed hits it too. The taxis module keeps the link with a "(solo abre desde Colombia)" hint in all four languages; the two wa.me report links (Catalina DATT, Titán Chat) carry the actionable path.
- **www.cartagena.gov.co = Cloudflare bot wall for scripted clients.** 9 URLs (coches-electricos: all 4 official links; taxis: 1 official link + 2 fact sources; muelle-bodeguita: 2 fact sources) answer 403 "Attention Required! | Cloudflare / Sorry, you have been blocked" to curl AND headless Chrome, any UA, HEAD and GET (sets `__cf_bm`). A real phone browser most likely passes, but this is **unverified from this machine**: open https://www.cartagena.gov.co/carrozas-electricas once on a handset (Safari/Chrome, cellular). If it also blocks, coches-electricos has zero working official links and needs an alternative source (the Decreto 2296 PDF mirrored under public/data, or the Alcaldía's social channel).
- **fortificacionescartagena.com.co is slow, not dead.** murallas-de-cartagena and el-cuartel-de-las-bovedas timed out on a 25 s HEAD; GET succeeds with 2.0 s / 4.0 s / 6.8 s TTFB across three pages. The audit script uses GET with a 60 s timeout for this host. No data change.
- **How to run:** `python3 scripts/audit-city-links.py` classifies every URL in `backend/data/city_modules.json` as ok / slow / geo-block / bot-wall / dead and exits 1 only on dead links.
