"""Vercel Blob server-side storage (raw HTTP API — no JS SDK).

Partner photos/flyers used to be stored INLINE as base64 data: URLs on the Mongo
doc, which forced a ~500KB cap and bloated list payloads. This uploads the bytes to
Vercel Blob and returns a public CDN URL to store instead.

Fail-soft by design: if BLOB_READ_WRITE_TOKEN is absent or the API errors, every
function returns None so callers transparently keep the existing base64 path — the
feature "turns on" the moment the token is present, and never breaks if it isn't.

API shape verified against @vercel/blob SDK source (BLOB_API_VERSION = 12):
  PUT  https://blob.vercel-storage.com/<pathname>
       authorization: Bearer <token>, x-api-version: 12, x-content-type,
       x-add-random-suffix: 1, x-vercel-blob-access: public, x-cache-control-max-age
       body: raw bytes  ->  200 { url, downloadUrl, pathname, ... }
  POST https://blob.vercel-storage.com/delete  { urls: [<url>] }
"""
import os
import re
import base64
import logging
import httpx

logger = logging.getLogger("blob")

_API = os.environ.get("VERCEL_BLOB_API_URL", "https://blob.vercel-storage.com").rstrip("/")
_API_VERSION = "12"
_MAX_AGE = "31536000"  # 1 year — content is immutable (random-suffixed pathname)


def blob_enabled() -> bool:
    """True when a Blob store token is configured (feature is live)."""
    return bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))


def _token() -> str:
    return os.environ.get("BLOB_READ_WRITE_TOKEN", "")


def _decode_data_url(data_url: str) -> tuple[bytes | None, str]:
    """Return (bytes, mime) from a data: URL (or raw base64). (None, '') on failure."""
    mime = "image/jpeg"
    b64 = data_url
    if data_url.startswith("data:"):
        m = re.match(r"data:([^;]+);base64,(.*)$", data_url, re.DOTALL)
        if not m:
            return None, ""
        mime, b64 = m.group(1) or mime, m.group(2)
    try:
        return base64.b64decode(b64), mime
    except Exception:
        return None, ""


async def upload_data_url(data_url: str, *, pathname: str) -> str | None:
    """Upload a base64 data: URL to Blob; return the public CDN URL (or None to fall
    back to storing the base64 inline). `pathname` is a stable prefix; a random suffix
    is appended by Blob so re-uploads never collide."""
    if not _token():
        return None
    data, mime = _decode_data_url(data_url)
    if not data:
        return None
    return await upload_bytes(data, pathname=pathname, content_type=mime)


async def upload_bytes(data: bytes, *, pathname: str, content_type: str = "image/jpeg") -> str | None:
    token = _token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.put(
                f"{_API}/{pathname.lstrip('/')}",
                content=data,
                headers={
                    "authorization": f"Bearer {token}",
                    "x-api-version": _API_VERSION,
                    "x-content-type": content_type,
                    "x-add-random-suffix": "1",
                    "x-vercel-blob-access": "public",
                    "x-cache-control-max-age": _MAX_AGE,
                },
            )
        if resp.status_code >= 400:
            logger.error("[blob] upload %s failed: %s %s", pathname, resp.status_code, resp.text[:300])
            return None
        url = resp.json().get("url")
        if not url:
            logger.error("[blob] upload %s returned no url: %s", pathname, resp.text[:200])
        return url
    except Exception as exc:  # noqa: BLE001 — fail-soft to base64
        logger.error("[blob] upload %s error: %s", pathname, exc)
        return None


def is_blob_url(url: str) -> bool:
    return isinstance(url, str) and "blob.vercel-storage.com" in url


async def probe() -> dict:
    """TEMP diagnostic — attempt a tiny Blob PUT and return the raw outcome so the
    exact API response is visible without Vercel logs. Exposes NO secret (only the
    token's presence/length/format)."""
    token = _token()
    info: dict = {
        "blob_enabled": bool(token),
        "token_len": len(token),
        "token_format_ok": token.startswith("vercel_blob_rw_"),
        "api": _API, "api_version": _API_VERSION,
    }
    if not token:
        info["error"] = "no BLOB_READ_WRITE_TOKEN in this runtime"
        return info
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.put(
                f"{_API}/diag/probe.txt",
                content=b"amo-blob-probe",
                headers={
                    "authorization": f"Bearer {token}",
                    "x-api-version": _API_VERSION,
                    "x-content-type": "text/plain",
                    "x-add-random-suffix": "1",
                    "x-vercel-blob-access": "public",
                    "x-cache-control-max-age": _MAX_AGE,
                },
            )
        info["status"] = r.status_code
        info["body"] = r.text[:400]
        try:
            info["result_url"] = r.json().get("url")
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001
        info["exception"] = f"{type(exc).__name__}: {str(exc)[:300]}"
    return info


async def delete_url(blob_url: str) -> bool:
    """Best-effort delete of a Blob object. No-op for non-blob URLs / no token."""
    token = _token()
    if not token or not is_blob_url(blob_url):
        return False
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{_API}/delete",
                json={"urls": [blob_url]},
                headers={"authorization": f"Bearer {token}", "x-api-version": _API_VERSION},
            )
        return resp.status_code < 400
    except Exception as exc:  # noqa: BLE001
        logger.error("[blob] delete error: %s", exc)
        return False
