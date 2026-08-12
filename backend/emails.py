"""
Email service for AMO Cartagena — powered by Resend.
Handles: verification codes, welcome, password reset.

Drop FD — the transactional emails, rebuilt to the AMO trophy brand
("gold on midnight"): TABLE-based layout (Outlook-safe — no flexbox/grid),
fully inlined CSS, a hidden preheader (inbox preview line), a plain-text
fallback on every send (deliverability + accessibility), and dark-mode-safe
colors (explicit dark backgrounds + light text so a client's dark theme can't
invert the card to invisible). From: hola@amocartagena.co (the AMO domain,
SPF via send.amocartagena.co + DKIM resend._domainkey + DMARC all live).

Uses httpx (already in deps) instead of the resend SDK.
"""
import os
import re
import html
import httpx
import logging
import secrets

logger = logging.getLogger(__name__)

# Strip interior CR/LF + C0/C1 control chars (audit #2: a name with embedded
# CRLF must never reach a Subject header, even though the JSON transport
# already escapes it) and cap length before any use.
_CTRL = re.compile(r"[\r\n\x00-\x1f\x7f]")


def _plain(s: str) -> str:
    """Control-stripped, length-capped user text for PLAIN-TEXT parts and
    Subject lines — NOT entity-escaped (audit #3: text clients don't decode
    entities, so 'D'Angelo' must stay 'D'Angelo', not 'D&#x27;Angelo')."""
    return _CTRL.sub("", (s or "").strip())[:80]


def _safe(s: str) -> str:
    """HTML-escape user-controlled text (name) before it enters email HTML —
    a name like '<a href=evil>' must not inject markup — after control-strip."""
    return html.escape(_plain(s))

FROM_EMAIL = "hola@amocartagena.co"
FROM_NAME = "AMO Cartagena"
VERIFY_CODE_TTL_MINUTES = 15
SITE = "https://www.amocartagena.co"

# Brand tokens (mirror the app + share-card system)
_INK = "#070710"
_CARD = "#0E0E18"
_GOLD = "#D4AF37"
_GOLD_BRIGHT = "#F5D47A"
_TEXT = "#FFFFFF"
_MUTED = "rgba(255,255,255,0.62)"
_FAINT = "rgba(255,255,255,0.34)"
_SERIF = "Georgia, 'Times New Roman', serif"
_SANS = "'Helvetica Neue', Arial, sans-serif"


def _get_resend_key() -> str:
    """Read RESEND_API_KEY at call time (not import time) for Vercel compatibility."""
    return os.environ.get("RESEND_API_KEY", "")


async def _send_email(*, to: str, subject: str, html: str, text: str = "", log_label: str = "") -> bool:
    """Send an email via Resend API. Returns True on success. Includes a
    plain-text part whenever provided. `log_label` is a REDACTED name for the
    log line — never log a subject that embeds a secret (audit #8: the OTP
    lived in the verification subject and was written to Vercel logs in clear)."""
    api_key = _get_resend_key()
    if not api_key:
        logger.error("[emails] RESEND_API_KEY not configured — email not sent")
        return False
    payload = {
        "from": f"{FROM_NAME} <{FROM_EMAIL}>",
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=10,
            )
            if r.status_code in (200, 201):
                logger.info(f"[emails] Sent '{log_label or subject}' to {to}")
                return True
            logger.error(f"[emails] Resend API error {r.status_code}: {r.text}")
            return False
    except Exception as e:
        logger.error(f"[emails] Failed to send email: {e}")
        return False


def generate_verification_code() -> str:
    """Generate a cryptographically-random 6-digit numeric code."""
    return f"{secrets.randbelow(900000) + 100000}"


def _shell(*, preheader: str, inner: str) -> str:
    """The brand frame every email shares: hidden preheader, dark page, a
    gold-ruled card, serif wordmark, and footer. Table-based + inline CSS
    for maximum client support. `inner` is the body's table rows."""
    return f"""<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
</head>
<body style="margin:0;padding:0;background:{_INK};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">{preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_INK};margin:0;padding:0;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:{_CARD};border:1px solid rgba(212,175,55,0.30);border-radius:20px;overflow:hidden;">
  <tr><td align="center" style="padding:36px 32px 6px;">
    <img src="{SITE}/splash/amo-icon-512.png" width="66" height="66" alt="AMO Cartagena"
         style="display:block;margin:0 auto;border-radius:16px;border:1px solid rgba(212,175,55,0.30);">
    <div style="font-family:{_SERIF};font-size:29px;color:{_TEXT};margin-top:13px;">Cartagena</div>
    <div style="width:58px;height:2px;background:{_GOLD};margin:15px auto 0;line-height:2px;font-size:0;">&nbsp;</div>
  </td></tr>
  {inner}
  <tr><td style="padding:24px 32px 34px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="margin:0 0 5px;font-family:{_SANS};font-size:11px;color:{_FAINT};text-align:center;">
      © 2026 AMO Cartagena · Cartagena de Indias, Colombia
    </p>
    <p style="margin:0;font-family:{_SANS};font-size:11px;color:{_FAINT};text-align:center;">
      <a href="{SITE}" style="color:{_GOLD};text-decoration:none;">amocartagena.co</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _code_box(code: str) -> str:
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:6px 0 22px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:rgba(212,175,55,0.08);border:2px solid {_GOLD};border-radius:14px;padding:18px 34px;">
            <span style="font-family:{_SERIF};font-size:40px;letter-spacing:12px;color:{_GOLD_BRIGHT};font-weight:700;">{code}</span>
          </td></tr>
        </table>
      </td></tr></table>"""


def _admin_rows(title: str, lines: list) -> str:
    body = "".join(
        f'<p style="margin:0 0 6px;font-family:{_SANS};font-size:14px;color:{_TEXT};line-height:20px;">{_safe(str(l))}</p>'
        for l in lines
    )
    return f"""<tr><td style="padding:6px 32px 26px;">
      <p style="margin:0 0 12px;font-family:{_SERIF};font-size:21px;color:{_GOLD_BRIGHT};">{_safe(title)}</p>
      {body}
      <p style="margin:20px 0 0;font-family:{_SANS};font-size:12px;color:{_MUTED};">
        Revisá y gestioná en el panel:
        <a href="{SITE}/admin" style="color:{_GOLD};text-decoration:none;">{SITE}/admin</a>
      </p>
    </td></tr>"""


async def send_admin_alert(*, subject: str, title: str, lines: list) -> bool:
    """Notify the AMO team of a business event — signup, ownership claim, or a
    new-venue submission. Recipients come from ADMIN_ALERT_EMAILS (comma-sep).
    Fail-soft: a no-op when unset so it NEVER blocks the user's action, and each
    recipient is sent independently so one bad address can't drop the rest."""
    raw = os.environ.get("ADMIN_ALERT_EMAILS", "").strip()
    recipients = [e.strip() for e in raw.split(",") if e.strip() and "@" in e]
    if not recipients:
        return False
    html = _shell(preheader=title, inner=_admin_rows(title, lines))
    text = f"{title}\n\n" + "\n".join(str(l) for l in lines) + f"\n\nPanel: {SITE}/admin"
    sent_any = False
    for addr in recipients:
        if await _send_email(to=addr, subject=subject, html=html, text=text, log_label="admin_alert"):
            sent_any = True
    return sent_any


async def send_verification_email(*, to: str, code: str, name: str = "") -> bool:
    """6-digit code to prove ownership of an email (consumer sign-in + business claim)."""
    greeting = f"Hola {_safe(name)}" if name else "Hola"
    preheader = f"Tu código AMO es {code} — válido por {VERIFY_CODE_TTL_MINUTES} minutos."
    inner = f"""
  <tr><td style="padding:26px 34px 0;">
    <p style="margin:0 0 6px;font-family:{_SANS};font-size:16px;color:{_TEXT};">{greeting},</p>
    <p style="margin:0 0 20px;font-family:{_SANS};font-size:14px;line-height:1.6;color:{_MUTED};">
      Tu código de verificación para entrar a AMO Cartagena:
    </p>
  </td></tr>
  <tr><td style="padding:0 34px;">{_code_box(code)}</td></tr>
  <tr><td style="padding:0 34px 30px;">
    <p style="margin:0 0 6px;font-family:{_SANS};font-size:13px;line-height:1.5;color:{_FAINT};">
      Este código expira en {VERIFY_CODE_TTL_MINUTES} minutos.
    </p>
    <p style="margin:0;font-family:{_SANS};font-size:13px;line-height:1.5;color:{_FAINT};">
      Si no lo solicitaste, podés ignorar este mensaje — nadie entra sin el código.
    </p>
  </td></tr>"""
    gt = f"Hola {_plain(name)}" if name else "Hola"
    text = (f"{gt},\n\nTu código de verificación para AMO Cartagena es: {code}\n"
            f"Expira en {VERIFY_CODE_TTL_MINUTES} minutos.\n\n"
            f"Si no lo solicitaste, ignoralo.\n\n— AMO Cartagena · {SITE}")
    return await _send_email(to=to, subject=f"Tu código AMO: {code}",
                             html=_shell(preheader=preheader, inner=inner), text=text,
                             log_label="Código de verificación")


async def send_password_reset_email(*, to: str, code: str, name: str = "") -> bool:
    """Business-portal password reset. Code-based by design (a 6-digit code
    can't be clicked from a spoofed email into an attacker's page the way a
    reset LINK can — more phishing-resistant). The code is crypto-random,
    single-use, 15-min expiry, and invalidated when a new one is requested."""
    greeting = f"Hola {_safe(name)}" if name else "Hola"
    preheader = f"Tu código para restablecer la contraseña: {code} (válido {VERIFY_CODE_TTL_MINUTES} min)."
    inner = f"""
  <tr><td style="padding:26px 34px 0;">
    <p style="margin:0 0 6px;font-family:{_SANS};font-size:16px;color:{_TEXT};">{greeting},</p>
    <p style="margin:0 0 20px;font-family:{_SANS};font-size:14px;line-height:1.6;color:{_MUTED};">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta de negocio.
      Ingresá este código en la app para elegir una nueva contraseña:
    </p>
  </td></tr>
  <tr><td style="padding:0 34px;">{_code_box(code)}</td></tr>
  <tr><td style="padding:0 34px 30px;">
    <p style="margin:0 0 6px;font-family:{_SANS};font-size:13px;line-height:1.5;color:{_FAINT};">
      El código expira en {VERIFY_CODE_TTL_MINUTES} minutos y solo sirve una vez.
      Pedir uno nuevo anula el anterior.
    </p>
    <p style="margin:0;font-family:{_SANS};font-size:13px;line-height:1.5;color:{_FAINT};">
      Si no pediste este cambio, ignorá este mensaje — tu contraseña sigue igual.
    </p>
  </td></tr>"""
    gt = f"Hola {_plain(name)}" if name else "Hola"
    text = (f"{gt},\n\nCódigo para restablecer tu contraseña de negocio AMO: {code}\n"
            f"Válido {VERIFY_CODE_TTL_MINUTES} minutos, un solo uso. Pedir uno nuevo anula el anterior.\n\n"
            f"Si no lo pediste, ignoralo — tu contraseña sigue igual.\n\n— AMO Cartagena · {SITE}")
    return await _send_email(to=to, subject="Restablecé tu contraseña — AMO Cartagena",
                             html=_shell(preheader=preheader, inner=inner), text=text)


_WELCOME_FEATURES = [
    ("🗺️", "Mapa interactivo", "890+ lugares, restaurantes y experiencias reales"),
    ("🧭", "Pasaporte de Cartagena", "Sellá los lugares que descubrís caminando la ciudad"),
    ("💬", "Luna, tu concierge", "Recomendaciones personales, a cualquier hora"),
    ("🧳", "Mi Viaje", "Armá el itinerario y planealo con tu grupo"),
]


async def send_welcome_email(*, to: str, name: str = "") -> bool:
    """Welcome email after a consumer verifies their account."""
    greeting = _safe(name) or "viajero"
    greeting_text = _plain(name) or "viajero"
    preheader = "Tu pasaporte de Cartagena te espera — sellá tu primer lugar."
    rows = ""
    for icon, title, desc in _WELCOME_FEATURES:
        rows += f"""
      <tr>
        <td width="44" valign="top" style="padding:0 12px 16px 0;font-size:24px;line-height:1;">{icon}</td>
        <td valign="top" style="padding:0 0 16px;">
          <div style="font-family:{_SANS};font-size:15px;color:{_GOLD_BRIGHT};font-weight:700;">{title}</div>
          <div style="font-family:{_SANS};font-size:13px;color:{_MUTED};line-height:1.5;">{desc}</div>
        </td>
      </tr>"""
    inner = f"""
  <tr><td align="center" style="padding:22px 34px 4px;">
    <div style="font-family:{_SERIF};font-size:26px;color:{_TEXT};">¡Bienvenido, {greeting}!</div>
  </td></tr>
  <tr><td style="padding:12px 34px 0;">
    <p style="margin:0 0 22px;font-family:{_SANS};font-size:14px;line-height:1.6;color:{_MUTED};text-align:center;">
      Tu cuenta está lista. Esto es lo que te espera en Cartagena:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>
  </td></tr>
  <tr><td align="center" style="padding:10px 34px 34px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:{_GOLD};border-radius:999px;">
        <a href="{SITE}" style="display:inline-block;padding:14px 34px;font-family:{_SANS};font-size:15px;font-weight:700;color:#0A0A0A;text-decoration:none;">Explorar Cartagena →</a>
      </td>
    </tr></table>
  </td></tr>"""
    text = (f"¡Bienvenido, {greeting_text}!\n\nTu cuenta AMO Cartagena está lista. Esto te espera:\n"
            + "\n".join(f"· {t}: {d}" for _, t, d in _WELCOME_FEATURES)
            + f"\n\nExplorar Cartagena: {SITE}\n\n— AMO Cartagena")
    return await _send_email(to=to, subject=f"¡Bienvenido a AMO Cartagena, {greeting_text}! 🌴",
                             html=_shell(preheader=preheader, inner=inner), text=text)


def _button(label: str, url: str) -> str:
    """The shared gold pill CTA — one look for every email's primary action."""
    return f"""<tr><td align="center" style="padding:6px 34px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:{_GOLD};border-radius:999px;">
          <a href="{url}" style="display:inline-block;padding:14px 36px;font-family:{_SANS};font-size:15px;font-weight:700;color:#0A0A0A;text-decoration:none;">{label}</a>
        </td></tr></table>
    </td></tr>"""


async def send_partner_invite_email(*, to: str, name: str, activation_url: str, category: str = "") -> bool:
    """Invite a business to activate its AMO Cartagena listing (magic activation link)."""
    cat = f" · {_safe(category)}" if category else ""
    preheader = f"Activá el perfil de {_plain(name)} en AMO Cartagena."
    inner = f"""
  <tr><td align="center" style="padding:22px 34px 2px;">
    <div style="font-family:{_SERIF};font-size:25px;color:{_TEXT};">Te invitamos a AMO Cartagena</div>
  </td></tr>
  <tr><td style="padding:14px 34px 0;">
    <p style="margin:0 0 8px;font-family:{_SANS};font-size:16px;color:{_TEXT};">Hola {_safe(name)},</p>
    <p style="margin:0 0 22px;font-family:{_SANS};font-size:14px;line-height:1.6;color:{_MUTED};">
      Tu negocio <b style="color:{_GOLD_BRIGHT};">{_safe(name)}{cat}</b> fue seleccionado para estar en
      AMO Cartagena — la guía y concierge de la ciudad. Activá tu perfil para gestionar tus fotos,
      horarios y reservas por WhatsApp, y aparecer ante miles de viajeros y locales.
    </p>
  </td></tr>
  {_button("Activar mi negocio →", activation_url)}
  <tr><td style="padding:0 34px 30px;">
    <p style="margin:0;font-family:{_SANS};font-size:12.5px;line-height:1.5;color:{_FAINT};">
      Si el botón no abre, copiá este enlace:<br>
      <a href="{activation_url}" style="color:{_GOLD};word-break:break-all;">{activation_url}</a>
    </p>
  </td></tr>"""
    text = (f"Hola {_plain(name)},\n\nTu negocio {_plain(name)}{(' - '+_plain(category)) if category else ''} "
            f"fue invitado a AMO Cartagena. Activá tu perfil aquí:\n{activation_url}\n\n— AMO Cartagena · {SITE}")
    return await _send_email(to=to, subject="Activá tu negocio en AMO Cartagena 🌴",
                             html=_shell(preheader=preheader, inner=inner), text=text,
                             log_label="Invitación de negocio")


async def send_venue_approved_email(*, to: str, name: str) -> bool:
    """Tell a partner their venue is approved and now live in the catalog."""
    preheader = f"{_plain(name)} ya está en vivo en AMO Cartagena."
    inner = f"""
  <tr><td align="center" style="padding:22px 34px 2px;">
    <div style="font-family:{_SERIF};font-size:25px;color:{_TEXT};">¡{_safe(name)} está en vivo! 🎉</div>
  </td></tr>
  <tr><td style="padding:14px 34px 4px;">
    <p style="margin:0 0 20px;font-family:{_SANS};font-size:14px;line-height:1.6;color:{_MUTED};text-align:center;">
      Tu negocio ya aparece en AMO Cartagena ante miles de viajeros y locales.
      Entrá cuando quieras para mantener tus fotos, horarios y ofertas al día.
    </p>
  </td></tr>
  {_button("Gestionar mi negocio →", f"{SITE}/business/login")}"""
    text = (f"¡{_plain(name)} ya está en vivo en AMO Cartagena!\n"
            f"Gestioná tu perfil: {SITE}/business/login\n\n— AMO Cartagena")
    return await _send_email(to=to, subject=f"¡{_plain(name)} ya está en AMO Cartagena! 🌴",
                             html=_shell(preheader=preheader, inner=inner), text=text,
                             log_label="Negocio aprobado")


async def send_itinerary_email(*, to: str, title: str, stops: list, subtitle: str = "", sender_name: str = "") -> bool:
    """Email a trip / day itinerary as a branded, keepable plan."""
    rows = ""
    for s in (stops or []):
        t = _safe(s.get("time") or "")
        nm = _safe(s.get("title") or s.get("venue") or s.get("name") or "")
        venue = _safe(s.get("venue") or "")
        why = _safe(s.get("why") or s.get("note") or "")
        meta = venue if venue and venue != nm else ""
        rows += f"""
      <tr>
        <td width="56" valign="top" style="padding:0 14px 18px 0;font-family:{_SERIF};font-size:15px;color:{_GOLD_BRIGHT};white-space:nowrap;">{t or '•'}</td>
        <td valign="top" style="padding:0 0 18px 16px;border-left:1px solid rgba(212,175,55,0.25);">
          <div style="font-family:{_SANS};font-size:15px;color:{_TEXT};font-weight:700;">{nm}</div>
          {f'<div style="font-family:{_SANS};font-size:13px;color:{_MUTED};margin-top:2px;">{meta}</div>' if meta else ''}
          {f'<div style="font-family:{_SANS};font-size:12.5px;color:{_FAINT};margin-top:4px;line-height:1.5;">{why}</div>' if why else ''}
        </td>
      </tr>"""
    frm = f" · de {_safe(sender_name)}" if sender_name else ""
    sub = f"{_safe(subtitle)}{frm}" if (subtitle or frm) else ""
    preheader = f"{_plain(title)} — tu plan para Cartagena."
    inner = f"""
  <tr><td align="center" style="padding:22px 34px 2px;">
    <div style="font-family:{_SERIF};font-size:25px;color:{_TEXT};">{_safe(title)}</div>
    {f'<div style="font-family:{_SANS};font-size:13px;color:{_MUTED};margin-top:6px;">{sub}</div>' if sub else ''}
  </td></tr>
  <tr><td style="padding:24px 34px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows or '<tr><td style="color:'+_MUTED+';font-family:'+_SANS+';font-size:14px;">Tu plan está vacío — agregá lugares en la app.</td></tr>'}</table>
  </td></tr>
  {_button("Abrir en AMO Cartagena →", SITE)}"""
    tlines = []
    for s in (stops or []):
        nm = s.get("title") or s.get("venue") or s.get("name") or ""
        v = s.get("venue") or ""
        tlines.append(f"{s.get('time','•')}  {_plain(nm)}" + (f" — {_plain(v)}" if v and v != nm else ""))
    text = f"{_plain(title)}\n\n" + "\n".join(tlines) + f"\n\nAbrir en AMO Cartagena: {SITE}\n\n— AMO Cartagena"
    return await _send_email(to=to, subject=f"Tu plan para Cartagena: {_plain(title)} 🌴",
                             html=_shell(preheader=preheader, inner=inner), text=text,
                             log_label="Itinerario")
