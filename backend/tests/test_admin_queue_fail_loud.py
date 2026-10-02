"""P0-C (audit 2026-10-01): the admin queues rendered "all clear" on load failure.

frontend/app/business/admin/queue.tsx turned every failed fetch into {drafts: []}
/ EMPTY_SUBMISSIONS and swallowed the rest; frontend/app/admin/moderation.tsx
swallowed the error and painted "¡Todo en orden!"; frontend/app/admin.tsx dropped
the moderation badge with .catch(() => null). Source guards (same cross-tree
precedent as test_port_tax_retired.py): the fail-soft wrappers stay gone, a
loadError banner exists, and every "nothing pending" state is gated on an
error-free load.
"""
import os
import re

FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "app")
BANNER = "No se pudo cargar la cola. Esto NO significa que esté vacía."


def _read(*parts: str) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_queue_screen_fails_loud() -> None:
    src = _read("business", "admin", "queue.tsx")
    assert ".catch(() => ({ drafts: [] }))" not in src
    assert ".catch(() => ({ claims: [] }))" not in src
    assert ".catch(() => EMPTY_SUBMISSIONS)" not in src
    assert "/* fail soft */" not in src
    assert "useState<Submissions | null>(null)" in src, "data starts as null, not as an empty queue"
    assert "setLoadError(" in src and BANNER in src and "Reintentar" in src
    assert "const loaded = !loadError && submissions !== null;" in src
    # every empty-state line is gated on `loaded`
    for empty in ("Sin borradores pendientes", "Sin reclamos pendientes", "Sin contenido pendiente"):
        lines = [l for l in src.splitlines() if empty in l and "styles.empty" in l]
        assert lines, f"render line for {empty!r} not found"
        for line in lines:
            # the gate is either on the same line or on the opening line of a
            # multi-line `{loaded && … && (` block directly above it
            idx = src.splitlines().index(line)
            window = "\n".join(src.splitlines()[max(0, idx - 1): idx + 1])
            assert "loaded &&" in window, f"{empty!r} must render only after an error-free load"


def test_moderation_screen_fails_loud() -> None:
    src = _read("admin", "moderation.tsx")
    assert "useState<any[] | null>(null)" in src
    assert "setLoadError(" in src and BANNER in src and "Reintentar" in src
    assert "!loadError && pending !== null && pending.length === 0" in src, "'¡Todo en orden!' gated on a real load"
    # the error branch keeps the last known list: no reset of pending/stats inside catch
    catch_block = src[src.index("} catch (e: any) {"): src.index("}, []);")]
    assert "setPending(" not in catch_block and "setStats(" not in catch_block


def test_portal_badge_keeps_last_value_and_flags_a_failed_refresh() -> None:
    src = _read("admin.tsx")
    assert "badgeStale" in src and "setModStatsStale(true)" in src and "setModStatsStale(false)" in src
    assert re.search(r"api\.get\('/admin/moderation/stats'\)\.then\(", src), "stats fetch must report success/failure"
    assert "badgeStale: modStatsStale" in src
    assert "hubCardStale:" in src and "hubCardStaleText:" in src, "the '!' indicator styles must exist"
    # the last known count is never cleared on failure
    assert "if (ms) setModStats(ms);" in src
