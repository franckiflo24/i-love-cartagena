"""
Email service for AMO Cartagena — powered by Resend.
Handles: verification codes, welcome emails, transactional notifications.

Uses httpx (already in deps) instead of the resend SDK to avoid extra dependency.
"""
import os
import httpx
import logging
import secrets
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

FROM_EMAIL = "hola@amocartagena.co"
FROM_NAME = "AMO Cartagena"
VERIFY_CODE_TTL_MINUTES = 15


def _get_resend_key() -> str:
    """Read RESEND_API_KEY at call time (not import time) for Vercel compatibility."""
    return os.environ.get("RESEND_API_KEY", "")


async def _send_email(*, to: str, subject: str, html: str) -> bool:
    """Send an email via Resend API. Returns True on success."""
    api_key = _get_resend_key()
    if not api_key:
        logger.error("[emails] RESEND_API_KEY not configured — email not sent")
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"{FROM_NAME} <{FROM_EMAIL}>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
                timeout=10,
            )
            if r.status_code in (200, 201):
                logger.info(f"[emails] Sent '{subject}' to {to}")
                return True
            else:
                logger.error(f"[emails] Resend API error {r.status_code}: {r.text}")
                return False
    except Exception as e:
        logger.error(f"[emails] Failed to send email: {e}")
        return False


def generate_verification_code() -> str:
    """Generate a 6-digit numeric verification code."""
    return f"{secrets.randbelow(900000) + 100000}"


async def send_verification_email(*, to: str, code: str, name: str = "") -> bool:
    """Send a 6-digit verification code email."""
    greeting = f"Hola {name}" if name else "Hola"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#050814;font-family:'Helvetica Neue',Arial,sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#0a0a14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#D97706,#F59E0B);padding:32px 24px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">AMO Cartagena</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Tu guía definitiva de Cartagena de Indias</p>
        </div>
        <!-- Body -->
        <div style="padding:32px 24px;">
          <p style="color:#fff;font-size:16px;margin:0 0 8px;">{greeting},</p>
          <p style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;margin:0 0 24px;">
            Tu código de verificación para AMO Cartagena es:
          </p>
          <div style="background:rgba(217,119,6,0.1);border:2px solid #D97706;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
            <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#F59E0B;font-family:monospace;">{code}</span>
          </div>
          <p style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.5;margin:0 0 8px;">
            Este código expira en {VERIFY_CODE_TTL_MINUTES} minutos.
          </p>
          <p style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.5;margin:0;">
            Si no solicitaste este código, puedes ignorar este mensaje.
          </p>
        </div>
        <!-- Footer -->
        <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
          <p style="margin:0;color:rgba(255,255,255,0.3);font-size:11px;">
            © 2026 AMO Cartagena · Cartagena de Indias, Colombia
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    return await _send_email(to=to, subject=f"Tu código AMO: {code}", html=html)


async def send_welcome_email(*, to: str, name: str = "") -> bool:
    """Send a welcome email after successful verification."""
    greeting = name or "viajero"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#050814;font-family:'Helvetica Neue',Arial,sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#0a0a14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#D97706,#F59E0B);padding:32px 24px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">¡Bienvenido/a! 🎉</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Tu cuenta AMO Cartagena está lista</p>
        </div>
        <!-- Body -->
        <div style="padding:32px 24px;">
          <p style="color:#fff;font-size:16px;margin:0 0 16px;">Hola {greeting},</p>
          <p style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;margin:0 0 20px;">
            Tu cuenta está verificada. Ahora tienes acceso a todo lo que Cartagena tiene para ofrecer:
          </p>
          <div style="margin:0 0 24px;">
            <div style="display:flex;align-items:center;margin-bottom:12px;">
              <span style="font-size:20px;margin-right:12px;">🗺️</span>
              <span style="color:rgba(255,255,255,0.8);font-size:14px;"><b style="color:#F59E0B;">Mapa interactivo</b> — 700+ lugares, restaurantes y experiencias</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:12px;">
              <span style="font-size:20px;margin-right:12px;">🤖</span>
              <span style="color:rgba(255,255,255,0.8);font-size:14px;"><b style="color:#F59E0B;">Concierge IA</b> — Recomendaciones personalizadas 24/7</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:12px;">
              <span style="font-size:20px;margin-right:12px;">🎶</span>
              <span style="color:rgba(255,255,255,0.8);font-size:14px;"><b style="color:#F59E0B;">Eventos y conciertos</b> — Nunca te pierdas nada</span>
            </div>
            <div style="display:flex;align-items:center;">
              <span style="font-size:20px;margin-right:12px;">🏖️</span>
              <span style="color:rgba(255,255,255,0.8);font-size:14px;"><b style="color:#F59E0B;">City Pass</b> — Descuentos exclusivos en toda la ciudad</span>
            </div>
          </div>
          <a href="https://www.amocartagena.co" style="display:block;text-align:center;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700;">
            Explorar Cartagena →
          </a>
        </div>
        <!-- Footer -->
        <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
          <p style="margin:0 0 4px;color:rgba(255,255,255,0.3);font-size:11px;">
            © 2026 AMO Cartagena · Cartagena de Indias, Colombia
          </p>
          <p style="margin:0;color:rgba(255,255,255,0.25);font-size:10px;">
            Recibiste este email porque creaste una cuenta en amocartagena.co
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    return await _send_email(to=to, subject=f"Bienvenido/a a AMO Cartagena, {greeting}! 🌴", html=html)
