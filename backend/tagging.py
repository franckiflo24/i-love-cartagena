"""Knowledge tags — the occasion/feature layer of the AMO knowledge graph.

A controlled vocabulary of ~20 tags on every partner ("romantic", "sea_view",
"kid_friendly", "english_friendly", "indoor"...). Bootstrapped by Claude from
existing partner data, refined later by partners and curation. Driven by the
demand report: "cena romántica" was the #1 unmet search because the catalog
had no romantic attribute at all.

Backfill: POST /api/admin/tags/backfill?batch=36 (admin user OR Bearer
CRON_SECRET). Processes untagged partners in LLM sub-batches; call repeatedly
until remaining=0. Use force=true to re-tag everything.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("tagging")

router = APIRouter()

db = None
_require_admin = None

# key: strict definition Claude tags against. Keep keys stable — search
# synonyms (frontend + backend) and UI labels map to these exact keys.
TAG_VOCAB: Dict[str, str] = {
    "romantic": "ambiente romántico: íntimo, velas, para parejas, cena especial",
    "first_date": "ideal primera cita: con encanto pero sin formalidad excesiva",
    "family": "apto para familias",
    "kid_friendly": "explícitamente bueno con niños (espacio, menú o actividades para niños)",
    "group_friendly": "funciona para grupos grandes (6+)",
    "business": "adecuado para almuerzo/cena de negocios: tranquilo, formal",
    "celebration": "para celebraciones: cumpleaños, aniversarios, despedidas",
    "sea_view": "vista al mar",
    "sunset_view": "atardecer destacado (muralla, rooftop oeste, bahía)",
    "rooftop": "terraza en altura / rooftop",
    "outdoor_terrace": "terraza, patio o jardín al aire libre",
    "live_music": "música en vivo habitual",
    "late_night": "abre hasta tarde (después de medianoche)",
    "english_friendly": "atención en inglés confirmada o muy probable (zona turística premium, personal bilingüe)",
    "indoor": "plan bajo techo con aire acondicionado — sirve para día de lluvia",
    "budget": "económico, buena relación precio/calidad ($ o $$)",
    "luxury": "alta gama, experiencia premium ($$$)",
    "local_favorite": "frecuentado por locales, fuera del circuito turístico",
    "pet_friendly": "acepta mascotas",
    "healthy": "opciones saludables / vegetarianas / veganas destacadas",
}


def init(*, db_, require_admin):
    global db, _require_admin
    db = db_
    _require_admin = require_admin


async def _auth(request: Request):
    secret = os.environ.get("CRON_SECRET", "").strip()
    if secret and request.headers.get("Authorization", "") == f"Bearer {secret}":
        return
    try:
        await _require_admin(request)
    except HTTPException:
        raise HTTPException(status_code=403, detail="Admin or cron secret required")


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


TAG_SYSTEM = """Sos el etiquetador del catálogo de AMO Cartagena. Recibís una lista de negocios de Cartagena con sus datos y un vocabulario cerrado de tags con definiciones.

Respondé SOLO con JSON válido: {"<partner_id>": ["tag1", "tag2", ...], ...}

Reglas:
- SOLO tags del vocabulario, exactamente como están escritos.
- Asigná un tag únicamente si los datos del negocio (nombre, descripción, categoría, experiencia, precio, zona) lo respaldan con claridad o muy alta probabilidad. En duda, NO lo asignes.
- 0 a 6 tags por negocio. Un negocio sin evidencia queda con lista vacía [].
- price_range: "$" o "$$" puede respaldar budget; "$$$" puede respaldar luxury (junto con tier premium/elite).
- "romantic" exige señales reales (ambiente íntimo, vista, fine dining, terraza, pareja) — no lo asignes a fast food, farmacias, etc.
- Incluí TODOS los partner_id recibidos en la respuesta."""


def _partner_compact(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "partner_id": p.get("partner_id"),
        "name": p.get("name"),
        "category": p.get("category"),
        "subcategory": p.get("subcategory"),
        "cuisine": p.get("cuisine"),
        "tier": p.get("tier"),
        "price_range": p.get("price_range"),
        "address": p.get("address"),
        "experience": p.get("experience"),
        "description": (p.get("description") or "")[:300],
    }


async def _tag_chunk(chunk: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    from llm import llm_complete
    payload = {
        "vocabulario": TAG_VOCAB,
        "negocios": [_partner_compact(p) for p in chunk],
    }
    out = await llm_complete(
        TAG_SYSTEM,
        json.dumps(payload, ensure_ascii=False),
        model="claude-haiku-4-5",
        max_tokens=1500,
        temperature=0.0,
    )
    if not out:
        return {}
    try:
        parsed = json.loads(_strip_fences(out))
    except Exception:
        m = re.search(r"\{.*\}", out, re.S)
        try:
            parsed = json.loads(m.group(0)) if m else {}
        except Exception:
            logger.warning(f"[tagging] unparseable chunk output: {out[:200]}")
            return {}
    result = {}
    for pid, tags in (parsed or {}).items():
        if isinstance(tags, list):
            result[pid] = [t for t in tags if t in TAG_VOCAB][:6]
    return result


@router.post("/admin/tags/backfill")
async def tags_backfill(request: Request, batch: int = 36, force: bool = False):
    """Tag up to `batch` untagged partners (LLM sub-batches of 12). Call
    repeatedly until remaining=0."""
    await _auth(request)
    batch = max(1, min(batch, 60))
    query = {} if force else {"tags": {"$exists": False}}
    partners = await db.partners.find(
        query,
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
         "cuisine": 1, "tier": 1, "price_range": 1, "address": 1,
         "experience": 1, "description": 1},
    ).limit(batch).to_list(batch)

    tagged = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for i in range(0, len(partners), 12):
        chunk = partners[i:i + 12]
        tag_map = await _tag_chunk(chunk)
        for p in chunk:
            pid = p.get("partner_id")
            # Chunk failed or partner missing from output → leave untagged so a
            # later run retries it (never write tags:[] we didn't decide).
            if pid not in tag_map:
                continue
            await db.partners.update_one(
                {"partner_id": pid},
                {"$set": {"tags": tag_map[pid], "tags_source": "ai_bootstrap", "tagged_at": now_iso}},
            )
            tagged += 1

    remaining = await db.partners.count_documents({"tags": {"$exists": False}})
    tagged_total = await db.partners.count_documents({"tags": {"$exists": True}})
    return {"tagged_now": tagged, "remaining": remaining, "tagged_total": tagged_total}


@router.get("/admin/tags/stats")
async def tags_stats(request: Request):
    await _auth(request)
    rows = await db.partners.aggregate([
        {"$match": {"tags": {"$exists": True}}},
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]).to_list(50)
    total = await db.partners.count_documents({})
    tagged = await db.partners.count_documents({"tags": {"$exists": True}})
    return {"partners": total, "tagged": tagged, "tag_counts": {r["_id"]: r["n"] for r in rows}}
