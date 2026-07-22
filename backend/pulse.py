"""WhatsApp Partner Pulse — live "tonight" inventory via the Meta Cloud API.

Partners text the AMO WhatsApp number in plain language:
    "hoy: música en vivo 8pm, 2x1 mojitos hasta las 9"
Claude parses it into structured pulses (partner_pulses collection) that the
search ranking and the concierge surface as real-time local truth.

A new message replaces the partner's active pulses (latest message wins).
Texting "borrar" / "clear" / "cancelar" deactivates everything.

Env (Meta app → WhatsApp → API setup):
    WHATSAPP_VERIFY_TOKEN     webhook verification handshake (required for GET)
    WHATSAPP_TOKEN            Cloud API bearer token (required to send replies)
    WHATSAPP_PHONE_NUMBER_ID  sender phone-number id (required to send replies)
    WHATSAPP_APP_SECRET       enables strict X-Hub-Signature-256 verification
Webhook URL to register: https://<backend>/api/whatsapp/webhook
"""

import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

logger = logging.getLogger("pulse")

router = APIRouter()

db = None
_check_rate_limit = None
_get_current_business = None

BOGOTA = ZoneInfo("America/Bogota")
PULSE_TYPES = {"live_music", "happy_hour", "special", "event", "availability", "closure", "other"}
CLEAR_WORDS = ("borrar", "clear", "cancelar", "eliminar", "quitar")


def init(*, db_, check_rate_limit, get_current_business):
    global db, _check_rate_limit, _get_current_business
    db = db_
    _check_rate_limit = check_rate_limit
    _get_current_business = get_current_business


# ── Helpers ──────────────────────────────────────────────────────────

def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


async def _resolve_partners(wa_phone: str) -> List[Dict[str, Any]]:
    """All partners sharing this phone suffix — venue complexes (e.g. Casa
    Bohème: restaurant + bar + spa on one number) return several listings."""
    suffix = _digits(wa_phone)[-10:]
    if len(suffix) < 10:
        return []
    partners = await db.partners.find(
        {"$or": [{"phone": {"$exists": True, "$ne": ""}}, {"whatsapp": {"$exists": True, "$ne": ""}}]},
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "phone": 1, "whatsapp": 1},
    ).to_list(2000)
    out = []
    for p in partners:
        if any(_digits(p.get(f, ""))[-10:] == suffix for f in ("whatsapp", "phone")):
            out.append(p)
    return out


def _end_of_today_bogota_utc() -> str:
    now_bog = datetime.now(BOGOTA)
    eod = now_bog.replace(hour=23, minute=59, second=59, microsecond=0)
    return eod.astimezone(timezone.utc).isoformat()


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


PARSE_SYSTEM = """Eres el parser de "pulsos" de AMO Cartagena. Un negocio local te escribe por WhatsApp qué está pasando HOY en su local (música en vivo, happy hour, promo, plato especial, evento, cupos, cierre).

Respondé SOLO con JSON válido, sin markdown, con esta forma exacta:
{"clear": false, "pulses": [{"type": "live_music|happy_hour|special|event|availability|closure|other", "title": "titulo corto (max 60 chars, idioma del negocio)", "details": "detalle breve opcional", "start_time": "HH:MM o null", "end_time": "HH:MM o null"}], "reply": "confirmación breve y cálida en el idioma del mensaje, con 1 emoji"}

Reglas:
- Máximo 3 pulses por mensaje. Si el mensaje no describe nada de hoy (saludo, pregunta), devolvé pulses=[] y en reply explicá amablemente qué pueden enviar (ej: "hoy: música en vivo 8pm").
- Si el mensaje pide borrar/cancelar lo publicado, devolvé {"clear": true, "pulses": [], "reply": "confirmación de borrado"}.
- Horas en formato 24h HH:MM. No inventes horas ni datos que no estén en el mensaje.
- title SIEMPRE presente y autocontenido (ej: "Música en vivo 20:00", "2x1 mojitos hasta 21:00").
- Si el mensaje incluye una lista "candidatos" (varios negocios comparten este número), agregá "target_partner_id" al nivel superior con el partner_id del negocio que MEJOR corresponde al contenido del mensaje (ej: promo de cócteles → el bar; plato/cena → el restaurante). Si no es claro, usá el primero."""


async def _parse_pulse(raw_text: str, candidates: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    from llm import llm_complete
    now_bog = datetime.now(BOGOTA).strftime("%A %Y-%m-%d %H:%M")
    prompt = f"Ahora en Cartagena: {now_bog}\n"
    if candidates and len(candidates) > 1:
        cand = [{"partner_id": c["partner_id"], "name": c.get("name"), "category": c.get("category")} for c in candidates]
        prompt += f"candidatos (elegí target_partner_id): {json.dumps(cand, ensure_ascii=False)}\n"
    prompt += f"Mensaje del negocio:\n{raw_text[:500]}"
    out = await llm_complete(
        PARSE_SYSTEM,
        prompt,
        model="claude-haiku-4-5",
        max_tokens=500,
        temperature=0.0,
    )
    if not out:
        return None
    try:
        parsed = json.loads(_strip_fences(out))
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    pulses = []
    for p in (parsed.get("pulses") or [])[:3]:
        if not isinstance(p, dict) or not (p.get("title") or "").strip():
            continue
        pulses.append({
            "type": p.get("type") if p.get("type") in PULSE_TYPES else "other",
            "title": str(p["title"])[:80],
            "details": (str(p.get("details"))[:200] if p.get("details") else None),
            "start_time": p.get("start_time") or None,
            "end_time": p.get("end_time") or None,
        })
    return {
        "clear": bool(parsed.get("clear")),
        "pulses": pulses,
        "reply": (str(parsed.get("reply"))[:400] if parsed.get("reply") else None),
        "target_partner_id": parsed.get("target_partner_id") or None,
    }


async def _store_pulses(partner: Dict[str, Any], raw_text: str, pulses: List[Dict[str, Any]], source: str) -> int:
    """Latest message wins: deactivate previous actives, insert the new set."""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.partner_pulses.update_many(
        {"partner_id": partner["partner_id"], "active": True},
        {"$set": {"active": False, "deactivated_at": now_iso}},
    )
    docs = []
    for p in pulses:
        docs.append({
            "pulse_id": f"pls_{uuid.uuid4().hex[:12]}",
            "partner_id": partner["partner_id"],
            "partner_name": partner.get("name"),
            "source": source,
            "raw_text": raw_text[:500],
            **p,
            "valid_until": _end_of_today_bogota_utc(),
            "created_at": now_iso,
            "active": True,
        })
    if docs:
        await db.partner_pulses.insert_many(docs)
    return len(docs)


async def _send_whatsapp_reply(to_wa_id: str, text: str):
    token = os.environ.get("WHATSAPP_TOKEN", "").strip()
    phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    if not token or not phone_id:
        logger.info("[pulse] WHATSAPP_TOKEN/PHONE_NUMBER_ID not set — skipping reply send")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"https://graph.facebook.com/v21.0/{phone_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={"messaging_product": "whatsapp", "to": to_wa_id,
                      "type": "text", "text": {"body": text[:1000]}},
            )
            if r.status_code >= 300:
                logger.warning(f"[pulse] reply send failed {r.status_code}: {r.text[:200]}")
    except Exception as exc:
        logger.warning(f"[pulse] reply send error: {exc}")


# ── Read API used by search + concierge ──────────────────────────────

async def get_active_pulse_map(db_, partner_ids: Optional[List[str]] = None, limit: int = 60) -> Dict[str, Dict[str, Any]]:
    """partner_id -> newest active, unexpired pulse (compact)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    query: Dict[str, Any] = {"active": True, "valid_until": {"$gt": now_iso}}
    if partner_ids is not None:
        if not partner_ids:
            return {}
        query["partner_id"] = {"$in": partner_ids}
    rows = await db_.partner_pulses.find(
        query, {"_id": 0, "partner_id": 1, "partner_name": 1, "type": 1,
                "title": 1, "details": 1, "start_time": 1, "end_time": 1},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        out.setdefault(r["partner_id"], r)  # newest first
    return out


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/whatsapp/webhook")
async def whatsapp_verify(request: Request):
    """Meta webhook verification handshake."""
    params = request.query_params
    expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "").strip()
    if (params.get("hub.mode") == "subscribe" and expected
            and params.get("hub.verify_token") == expected):
        return PlainTextResponse(params.get("hub.challenge") or "")
    raise HTTPException(status_code=403, detail="verification failed")


@router.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Incoming WhatsApp messages → parsed pulses. Always 200 (Meta retries otherwise)."""
    raw = await request.body()

    app_secret = os.environ.get("WHATSAPP_APP_SECRET", "").strip()
    if app_secret:
        sig = request.headers.get("x-hub-signature-256", "")
        expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=403, detail="bad signature")
    else:
        logger.warning("[pulse] WHATSAPP_APP_SECRET not set — webhook signature NOT verified")

    try:
        payload = json.loads(raw)
    except Exception:
        return {"ok": True}

    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value") or {}
            for msg in value.get("messages", []) or []:
                if msg.get("type") != "text":
                    continue
                wa_id = msg.get("from") or ""
                text = ((msg.get("text") or {}).get("body") or "").strip()
                if not wa_id or not text:
                    continue
                try:
                    _check_rate_limit(f"pulse:{wa_id}", max_calls=10, window_sec=3600)
                except HTTPException:
                    continue
                try:
                    await _handle_pulse_message(wa_id, text)
                except Exception as exc:
                    logger.error(f"[pulse] message handling failed: {exc}")
    return {"ok": True}


async def _handle_pulse_message(wa_id: str, text: str):
    candidates = await _resolve_partners(wa_id)
    if not candidates:
        logger.info(f"[pulse] unknown sender …{_digits(wa_id)[-4:]}")
        await _send_whatsapp_reply(
            wa_id,
            "Hola 👋 Este es el canal de novedades para negocios aliados de AMO Cartagena. "
            "Tu número no está registrado como partner. Escríbenos en amocartagena.co para unirte.",
        )
        return

    lowered = text.lower()
    if any(lowered.startswith(w) or lowered == w for w in CLEAR_WORDS):
        # Clear actives across every listing on this number — it's their venue
        for c in candidates:
            await _store_pulses(c, text, [], source="whatsapp")
        await _send_whatsapp_reply(wa_id, "🗑️ Listo — borré las novedades de hoy de tu negocio.")
        return

    parsed = await _parse_pulse(text, candidates)
    if parsed is None:
        await _send_whatsapp_reply(
            wa_id, "No pude procesar tu mensaje 😅 Intenta algo como: \"hoy: música en vivo 8pm, 2x1 mojitos hasta las 9\"",
        )
        return

    # Venue complexes share one number — Claude picks the listing the message
    # is about; fall back to the first candidate.
    partner = candidates[0]
    if len(candidates) > 1 and parsed.get("target_partner_id"):
        partner = next((c for c in candidates if c["partner_id"] == parsed["target_partner_id"]), candidates[0])

    if parsed["clear"]:
        for c in candidates:
            await _store_pulses(c, text, [], source="whatsapp")
        await _send_whatsapp_reply(wa_id, parsed.get("reply") or f"🗑️ Novedades de hoy borradas para {partner.get('name')}.")
        return

    if not parsed["pulses"]:
        await _send_whatsapp_reply(
            wa_id,
            parsed.get("reply")
            or "Cuéntame qué hay HOY en tu local 🌴 Ej: \"hoy: música en vivo 8pm, 2x1 mojitos hasta las 9\"",
        )
        return

    n = await _store_pulses(partner, text, parsed["pulses"], source="whatsapp")
    titles = " · ".join(p["title"] for p in parsed["pulses"])
    await _send_whatsapp_reply(
        wa_id,
        parsed.get("reply") or f"✅ Publicado en AMO Cartagena ({n}): {titles}. Vence esta medianoche — escribe de nuevo mañana.",
    )
    logger.info(f"[pulse] {partner['partner_id']} published {n} pulse(s) via whatsapp")


# ── Business-portal parity (no WhatsApp needed) ──────────────────────

@router.post("/business/pulse")
async def business_post_pulse(request: Request):
    """Same pipeline, from the business portal. Body: {text: str}"""
    biz = await _get_current_business(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text or len(text) > 500:
        raise HTTPException(status_code=400, detail="text required (max 500 chars)")
    partner = await db.partners.find_one(
        {"partner_id": biz.get("partner_id")}, {"_id": 0, "partner_id": 1, "name": 1},
    )
    if not partner:
        raise HTTPException(status_code=404, detail="partner not found")
    parsed = await _parse_pulse(text)
    if parsed is None:
        raise HTTPException(status_code=502, detail="could not parse pulse")
    if parsed["clear"] or not parsed["pulses"]:
        await _store_pulses(partner, text, [], source="portal")
        return {"ok": True, "published": 0, "cleared": True, "reply": parsed.get("reply")}
    n = await _store_pulses(partner, text, parsed["pulses"], source="portal")
    return {"ok": True, "published": n, "pulses": parsed["pulses"], "reply": parsed.get("reply")}


@router.get("/business/pulse")
async def business_get_pulses(request: Request):
    biz = await _get_current_business(request)
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = await db.partner_pulses.find(
        {"partner_id": biz.get("partner_id"), "active": True, "valid_until": {"$gt": now_iso}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(10)
    return {"pulses": rows}


@router.delete("/business/pulse")
async def business_clear_pulses(request: Request):
    biz = await _get_current_business(request)
    res = await db.partner_pulses.update_many(
        {"partner_id": biz.get("partner_id"), "active": True},
        {"$set": {"active": False, "deactivated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True, "cleared": res.modified_count}
