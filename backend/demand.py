"""Demand mining — unmet-demand intelligence from real user behavior.

Sources:
  1. search_history — zero-result and thin-result queries (what people wanted
     and the catalog couldn't show)
  2. chat_sessions  — what users asked the concierge for
  3. partner taxonomy — what AMO currently covers

One Sonnet pass turns that into a structured report:
  - gaps:           demand with no partner offering it
  - taxonomy_fixes: demand that EXISTS but isn't findable (synonym/data fixes)
  - leads:          ranked business types to sign next, with a pitch in Spanish
                    backed by demand counts ("14 personas lo buscaron este mes")

Refresh: POST/GET /api/admin/demand/refresh (admin user OR Bearer CRON_SECRET —
Vercel cron sends that header natively). Latest report: GET /api/admin/demand.
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("demand")

router = APIRouter()

db = None
_require_admin = None


def init(*, db_, require_admin):
    global db, _require_admin
    db = db_
    _require_admin = require_admin


async def _auth(request: Request):
    """Admin user OR the Vercel cron secret."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    auth_header = request.headers.get("Authorization", "")
    if secret and auth_header == f"Bearer {secret}":
        return {"via": "cron"}
    try:
        user = await _require_admin(request)
        return {"via": "admin", "user_id": user.get("user_id")}
    except HTTPException:
        raise HTTPException(status_code=403, detail="Admin or cron secret required")


# ── Collection ───────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


async def _collect(days: int) -> Dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # Search demand, grouped by normalized query. "zero" = the search showed
    # nothing (new docs: empty impressions; legacy docs: 0 partner results).
    rows = await db.search_history.aggregate([
        {"$match": {"created_at": {"$gte": cutoff}, "query_lower": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$query_lower",
            "count": {"$sum": 1},
            # New docs: impressions[] is the truth. Legacy docs (pre behavioral
            # loop) had result_counts.partners / matches_count instead — fold
            # them in so old searches with results don't read as zero-result.
            "max_impressions": {"$max": {"$add": [
                {"$size": {"$ifNull": ["$impressions", []]}},
                {"$ifNull": ["$result_counts.partners", {"$ifNull": ["$matches_count", 0]}]},
            ]}},
            "last_seen": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 400},
    ]).to_list(400)

    zero, thin = [], []
    for r in rows:
        q = (r["_id"] or "").strip()
        if len(q) < 3 or len(q) > 80:
            continue
        entry = {"query": q, "count": r["count"], "last_seen": r.get("last_seen")}
        if r.get("max_impressions", 0) == 0:
            zero.append(entry)
        elif r.get("max_impressions", 0) < 3:
            thin.append(entry)

    # Concierge asks — user-side messages from recent sessions (fall back to
    # newest sessions overall if none carry updated_at in the window)
    sessions = await db.chat_sessions.find(
        {"updated_at": {"$gte": cutoff}}, {"_id": 0, "messages": 1},
    ).sort("updated_at", -1).limit(60).to_list(60)
    if not sessions:
        sessions = await db.chat_sessions.find(
            {}, {"_id": 0, "messages": 1},
        ).sort("created_at", -1).limit(60).to_list(60)
    chat_asks: List[str] = []
    for s in sessions:
        for m in s.get("messages", []) or []:
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                t = m["content"].strip()
                if 3 <= len(t) <= 200:
                    chat_asks.append(t)
    chat_asks = list(dict.fromkeys(chat_asks))[:200]  # dedupe, cap

    # Current coverage
    coverage = await db.partners.aggregate([
        {"$group": {"_id": {"c": "$category", "s": "$subcategory"}, "n": {"$sum": 1}}},
    ]).to_list(500)
    cov_map: Dict[str, Dict[str, int]] = {}
    for c in coverage:
        cat = c["_id"].get("c") or "?"
        sub = c["_id"].get("s") or "-"
        cov_map.setdefault(cat, {})[sub] = c["n"]

    total_searches = await db.search_history.count_documents({"created_at": {"$gte": cutoff}})
    return {
        "zero_queries": zero[:80],
        "thin_queries": thin[:40],
        "chat_asks": chat_asks,
        "coverage": cov_map,
        "total_searches": total_searches,
    }


MINE_SYSTEM = """Eres el analista de demanda de AMO Cartagena (app de turismo local, Cartagena de Indias). Recibes: búsquedas SIN resultados, búsquedas con resultados pobres, preguntas reales al concierge, y la cobertura actual del catálogo (categoria → subcategoria → # de negocios).

Tu trabajo: detectar DEMANDA INSATISFECHA real y convertirla en acción comercial. Respondé SOLO con JSON válido (sin markdown):

{
 "gaps": [{"demand": "qué piden (corto)", "category_guess": "categoria probable", "evidence_queries": ["..."], "est_requests": N, "severity": "high|medium|low", "note": "1 frase"}],
 "taxonomy_fixes": [{"query_pattern": "lo que buscan", "should_match": "lo que YA existe en el catálogo y debería aparecer", "fix": "sinónimo/dato a agregar"}],
 "leads": [{"rank": 1, "business_type": "tipo de negocio a firmar", "neighborhood_hint": "zona sugerida o null", "demand_evidence": ["queries/asks"], "est_requests": N, "pitch_es": "1-2 frases de pitch para el vendedor, citando la demanda real"}],
 "summary_es": "3-4 frases: hallazgos clave",
 "summary_en": "same in English"
}

Reglas:
- gaps = demanda que el catálogo NO cubre. taxonomy_fixes = demanda que SÍ está cubierta pero no se encuentra (mira la cobertura antes de declarar un gap).
- Ignorá ruido: typos sueltos, pruebas ("test", "asdf"), nombres propios sin señal de demanda, queries de una sola letra.
- est_requests = suma de counts de la evidencia (sé honesto, no infles).
- leads ordenados por potencial comercial (demanda × plausibilidad de firmar ese negocio en Cartagena). Máx 8 leads, 10 gaps, 8 fixes.
- Si los datos son pocos, decilo en summary y devolvé listas cortas — jamás inventes demanda."""


async def _mine(days: int) -> Dict[str, Any]:
    from llm import llm_complete
    inputs = await _collect(days)
    payload = {
        "window_days": days,
        "total_searches": inputs["total_searches"],
        "zero_result_queries": inputs["zero_queries"],
        "thin_result_queries": inputs["thin_queries"],
        "concierge_asks": inputs["chat_asks"],
        "current_coverage": inputs["coverage"],
    }
    out = await llm_complete(
        MINE_SYSTEM,
        json.dumps(payload, ensure_ascii=False),
        model="claude-sonnet-4-6",
        max_tokens=3000,
        temperature=0.2,
    )
    if not out:
        raise HTTPException(status_code=502, detail="mining LLM call failed")
    try:
        report = json.loads(_strip_fences(out))
    except Exception:
        raise HTTPException(status_code=502, detail="mining output not parseable")

    doc = {
        "report_id": f"dmr_{uuid.uuid4().hex[:12]}",
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "total_searches": inputs["total_searches"],
            "zero_queries": len(inputs["zero_queries"]),
            "thin_queries": len(inputs["thin_queries"]),
            "chat_asks": len(inputs["chat_asks"]),
        },
        "report": report,
    }
    await db.demand_reports.insert_one({**doc})
    doc.pop("_id", None)
    return doc


# ── Routes ───────────────────────────────────────────────────────────

@router.api_route("/admin/demand/refresh", methods=["GET", "POST"])
async def demand_refresh(request: Request, days: int = 30):
    """Regenerate the demand report. GET allowed so Vercel cron can call it."""
    await _auth(request)
    days = max(1, min(days, 120))
    doc = await _mine(days)
    logger.info(f"[demand] report {doc['report_id']} generated over {days}d")
    return doc


@router.get("/admin/demand")
async def demand_latest(request: Request):
    await _auth(request)
    doc = await db.demand_reports.find_one({}, {"_id": 0}, sort=[("generated_at", -1)])
    if not doc:
        return {"report": None, "message": "No report yet — call /admin/demand/refresh"}
    return doc
