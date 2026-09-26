#!/usr/bin/env python3
"""Sync the AMO Life city-hub data file from the backend to the frontend and validate it.

Source of truth   backend/data/city_modules.json          (full: research_notes + luna kept here)
Static copy       frontend/public/data/city/modules.json   (served as /data/city/modules.json)

The frontend copy is the PUBLIC view: every module minus `research_notes` (editorial audit
trail, local paths, source vetting) and `luna` (trigger lists + decline lines the LLM reads
server-side). Nothing in the client needs either, and stripping them keeps ~90 KB of internal
material out of a payload anyone can open. backend GET /api/city/modules serves the same
stripped shape (see server.py _city_public).

Usage, from any directory:
    python3 scripts/sync-city-data.py            validate the source, write the public copy, validate the copy
    python3 scripts/sync-city-data.py --check    validate both files, write nothing

Validation; every problem is printed to stderr and the exit code is 1:
  * the file parses as JSON and carries version, last_verified, source_doc and modules
  * exactly 6 modules, unique ids, listed in ascending order
  * every localized object has es, en, fr and pt as non-empty strings, walking
    title, tagline, summary, honest_note, status_reason, fallback and future (when not null),
    facts[].label, facts[].value_text and facts[].note (when not null),
    official_links[].label, every safety[] entry and image.caption (when present)
  * every facts[].last_verified equals the file's top-level last_verified
  * every status is one of info, proximamente or en_vivo, and none is en_vivo: no module may
    go live before a signed agreement exists, so that rule is relaxed here explicitly, never by data
  * every module has an image key, and a non-null image.file exists under frontend/public
  * French copy is written in TU (the register of the app chrome on the same screen): any
    vous / votre / vos or a vous-imperative (vérifiez, confirmez, …) in an fr value is an error
  * source only: every luna.amo_sells is false, luna.triggers is a non-empty list of strings and
    decline_line_es/en/fr/pt are non-empty
  * public copy only: no module carries research_notes or luna

Exit code 0 only when both files validate and the frontend copy equals the public view of the source.
"""
import copy
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "backend", "data", "city_modules.json")
DST = os.path.join(REPO, "frontend", "public", "data", "city", "modules.json")
PUBLIC = os.path.join(REPO, "frontend", "public")

LANGS = ("es", "en", "fr", "pt")
STATUSES = {"info", "proximamente", "en_vivo"}
EXPECTED_MODULES = 6
TOP_LEVEL_KEYS = ("version", "last_verified", "source_doc", "modules")
MODULE_L_KEYS = ("title", "tagline", "summary", "honest_note", "status_reason", "fallback")
INTERNAL_MODULE_KEYS = ("research_notes", "luna")
DECLINE_KEYS = tuple(f"decline_line_{lang}" for lang in LANGS)

# French register guard: the chrome (autoTr.ts) is tu, so the module copy must be too.
_FR_VOUS = re.compile(r"\b(vous|votre|vos)\b", re.IGNORECASE)
_FR_VOUS_IMPERATIVE = re.compile(
    r"\b(vérifiez|confirmez|prévoyez|achetez|arrivez|demandez|consultez|gardez|justifiez|choisissez|"
    r"payez|suivez|embarquez|retirez|fixez|portez|prenez|allez|partez|signalez|méfiez|organisez|réglez|"
    r"évitez|apportez|montez|exigez|réservez|utilisez|comptez|attendez|téléchargez|rechargez)\b",
    re.IGNORECASE,
)


def public_view(data):
    """The shape the frontend and GET /api/city/modules expose: modules minus internal keys."""
    out = copy.deepcopy(data)
    for module in out.get("modules") or []:
        if isinstance(module, dict):
            for key in INTERNAL_MODULE_KEYS:
                module.pop(key, None)
    return out


def _check_l(obj, where, errors):
    """Require obj to be a dict with a non-empty string for every language in LANGS."""
    if not isinstance(obj, dict):
        errors.append(f"{where}: expected a localized object, got {type(obj).__name__}")
        return
    for lang in LANGS:
        value = obj.get(lang)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{where}.{lang}: missing or empty")
    fr = obj.get("fr")
    if isinstance(fr, str):
        hit = _FR_VOUS.search(fr) or _FR_VOUS_IMPERATIVE.search(fr)
        if hit:
            errors.append(f"{where}.fr: vous-register ({hit.group(0)!r}) — module copy is tu")


def _check_list(module, key, where, errors):
    value = module.get(key)
    if not isinstance(value, list):
        errors.append(f"{where}.{key}: expected a list, got {type(value).__name__}")
        return []
    return value


def _check_luna(module, where, errors):
    luna = module.get("luna")
    if not isinstance(luna, dict):
        errors.append(f"{where}.luna: missing")
        return
    if luna.get("amo_sells") is not False:
        errors.append(f"{where}.luna.amo_sells must be false")
    triggers = luna.get("triggers")
    if not isinstance(triggers, list) or not triggers or not all(
        isinstance(t, str) and t.strip() for t in triggers
    ):
        errors.append(f"{where}.luna.triggers: expected a non-empty list of strings")
    for key in DECLINE_KEYS:
        value = luna.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{where}.luna.{key}: missing or empty")
    fr = luna.get("decline_line_fr")
    if isinstance(fr, str):
        hit = _FR_VOUS.search(fr) or _FR_VOUS_IMPERATIVE.search(fr)
        if hit:
            errors.append(f"{where}.luna.decline_line_fr: vous-register ({hit.group(0)!r})")


def validate(path, public):
    """Return a list of problems found in the city data file at path; empty means valid.
    public=True validates the stripped frontend copy, public=False the full backend source."""
    errors = []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        return [f"cannot load JSON: {exc}"]
    if not isinstance(data, dict):
        return ["top level is not an object"]

    for key in TOP_LEVEL_KEYS:
        if key not in data:
            errors.append(f"top-level '{key}' missing")
    modules = data.get("modules")
    if not isinstance(modules, list):
        errors.append("modules is not a list")
        return errors
    if len(modules) != EXPECTED_MODULES:
        errors.append(f"expected {EXPECTED_MODULES} modules, found {len(modules)}")

    ids = [m.get("id") if isinstance(m, dict) else None for m in modules]
    duplicates = sorted({i for i in ids if ids.count(i) > 1}, key=str)
    if duplicates:
        errors.append(f"duplicate module ids: {duplicates}")
    orders = [m.get("order") if isinstance(m, dict) else None for m in modules]
    if any(not isinstance(o, int) for o in orders):
        errors.append("every module needs an integer order")
    elif orders != sorted(orders):
        errors.append(f"modules are not sorted by order: {orders}")

    expected_date = data.get("last_verified")
    for index, module in enumerate(modules):
        if not isinstance(module, dict):
            errors.append(f"modules[{index}] is not an object")
            continue
        where = module.get("id") or f"modules[{index}]"

        for key in MODULE_L_KEYS:
            _check_l(module.get(key), f"{where}.{key}", errors)
        if module.get("future") is not None:
            _check_l(module["future"], f"{where}.future", errors)

        status = module.get("status")
        if status not in STATUSES:
            errors.append(f"{where}.status: {status!r} is not one of {sorted(STATUSES)}")
        elif status == "en_vivo":
            errors.append(f"{where}.status: en_vivo is not allowed without a signed agreement")

        if public:
            for key in INTERNAL_MODULE_KEYS:
                if key in module:
                    errors.append(f"{where}.{key}: internal key must not ship in the public copy")
        else:
            _check_luna(module, where, errors)

        for i, fact in enumerate(_check_list(module, "facts", where, errors)):
            fact_where = f"{where}.facts[{i}]"
            if not isinstance(fact, dict):
                errors.append(f"{fact_where}: not an object")
                continue
            _check_l(fact.get("label"), f"{fact_where}.label", errors)
            _check_l(fact.get("value_text"), f"{fact_where}.value_text", errors)
            if fact.get("note") is not None:
                _check_l(fact["note"], f"{fact_where}.note", errors)
            if fact.get("last_verified") != expected_date:
                errors.append(
                    f"{fact_where}.last_verified: {fact.get('last_verified')!r} != {expected_date!r}"
                )

        for i, link in enumerate(_check_list(module, "official_links", where, errors)):
            if not isinstance(link, dict):
                errors.append(f"{where}.official_links[{i}]: not an object")
                continue
            _check_l(link.get("label"), f"{where}.official_links[{i}].label", errors)

        for i, entry in enumerate(_check_list(module, "safety", where, errors)):
            _check_l(entry, f"{where}.safety[{i}]", errors)

        if "image" not in module:
            errors.append(f"{where}.image: key missing (use null when there is no image)")
        elif module["image"] is not None:
            image = module["image"]
            file_ref = image.get("file") if isinstance(image, dict) else None
            if not isinstance(file_ref, str) or not file_ref:
                errors.append(f"{where}.image.file: missing")
            elif not os.path.isfile(os.path.join(PUBLIC, file_ref.lstrip("/"))):
                errors.append(f"{where}.image.file: {file_ref} not found under frontend/public")
            if isinstance(image, dict) and image.get("caption") is not None:
                _check_l(image["caption"], f"{where}.image.caption", errors)
    return errors


def _report(path, errors):
    print(f"[sync-city-data] {os.path.relpath(path, REPO)}: {len(errors)} problem(s)", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)


def _dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main(argv):
    check_only = "--check" in argv

    errors = validate(SRC, public=False)
    if errors:
        _report(SRC, errors)
        return 1

    with open(SRC, encoding="utf-8") as fh:
        source = json.load(fh)
    expected = _dump(public_view(source))

    if not check_only:
        try:
            os.makedirs(os.path.dirname(DST), exist_ok=True)
            with open(DST, "w", encoding="utf-8") as fh:
                fh.write(expected)
        except OSError as exc:
            print(f"[sync-city-data] write failed: {exc}", file=sys.stderr)
            return 1

    errors = validate(DST, public=True)
    if errors:
        _report(DST, errors)
        return 1

    try:
        with open(DST, encoding="utf-8") as fh:
            actual = fh.read()
    except OSError as exc:
        print(f"[sync-city-data] cannot read frontend copy: {exc}", file=sys.stderr)
        return 1
    if actual != expected:
        print("[sync-city-data] frontend copy differs from the public view of the backend source", file=sys.stderr)
        return 1

    verb = "checked" if check_only else "synced"
    print(
        f"[sync-city-data] {verb} {len(source['modules'])} modules "
        f"(version {source['version']}, last_verified {source['last_verified']}) -> "
        f"{os.path.relpath(DST, REPO)} ({len(expected.encode('utf-8'))} bytes, public view)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
