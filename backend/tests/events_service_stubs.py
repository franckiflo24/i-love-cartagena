"""In-memory async Mongo subset for the EVENTS-ELITE service tests (no Atlas, no network).

Supports what events_elite / events_runtime / the sliced server.py handlers use: find (sort /
limit / to_list / async-for), find_one (sort), insert_one, update_one / update_many (with $set,
$unset, $setOnInsert, $push ($each/$position/$slice), $addToSet ($each), $inc, dotted paths,
upsert), find_one_and_update, delete_one / delete_many, count_documents, distinct, create_index
(unique / sparse, multikey arrays) and index_information. Unique violations raise pymongo's real
DuplicateKeyError. Every collection access is recorded in `db.accessed`.
"""
from __future__ import annotations

import copy
import itertools
from datetime import datetime
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

_MISSING = object()
_ids = itertools.count(1)


def _get(doc: Any, path: str) -> Any:
    cur = doc
    for part in path.split("."):
        if isinstance(cur, Mapping) and part in cur:
            cur = cur[part]
        else:
            return _MISSING
    return cur


def _set(doc: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cur = doc
    for p in parts[:-1]:
        if not isinstance(cur.get(p), dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def _unset(doc: Dict[str, Any], path: str) -> None:
    parts = path.split(".")
    cur: Any = doc
    for p in parts[:-1]:
        if not isinstance(cur, dict) or p not in cur:
            return
        cur = cur[p]
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)


def _cmp_ok(a: Any, b: Any) -> bool:
    return a is not _MISSING and a is not None and b is not None and \
        (isinstance(a, (int, float)) and isinstance(b, (int, float)) or type(a) is type(b)
         or (isinstance(a, datetime) and isinstance(b, datetime)))


def _eq(val: Any, target: Any) -> bool:
    if val is _MISSING:
        return target is None
    if isinstance(val, list) and not isinstance(target, list):
        return any(_eq(v, target) for v in val)
    return val == target


def _cond(val: Any, cond: Any) -> bool:
    if isinstance(cond, Mapping) and cond and all(str(k).startswith("$") for k in cond):
        for op, arg in cond.items():
            if op == "$in":
                if not any(_eq(val, a) for a in arg):
                    return False
            elif op == "$nin":
                if any(_eq(val, a) for a in arg):
                    return False
            elif op == "$ne":
                if _eq(val, arg):
                    return False
            elif op == "$exists":
                if (val is not _MISSING) != bool(arg):
                    return False
            elif op in ("$lt", "$lte", "$gt", "$gte"):
                vals = val if isinstance(val, list) else [val]
                ok = False
                for v in vals:
                    if not _cmp_ok(v, arg):
                        continue
                    if (op == "$lt" and v < arg) or (op == "$lte" and v <= arg) or \
                            (op == "$gt" and v > arg) or (op == "$gte" and v >= arg):
                        ok = True
                if not ok:
                    return False
            elif op == "$not":
                if _cond(val, arg):
                    return False
            elif op == "$regex":
                import re
                flags = re.I if "i" in str(cond.get("$options", "")) else 0
                if not isinstance(val, str) or not re.search(arg, val, flags):
                    return False
            elif op == "$options":
                continue
            else:
                raise NotImplementedError(op)
        return True
    return _eq(val, cond)


def matches(doc: Mapping[str, Any], q: Optional[Mapping[str, Any]]) -> bool:
    for k, cond in (q or {}).items():
        if k == "$or":
            if not any(matches(doc, sub) for sub in cond):
                return False
        elif k == "$and":
            if not all(matches(doc, sub) for sub in cond):
                return False
        elif k == "$nor":
            if any(matches(doc, sub) for sub in cond):
                return False
        elif not _cond(_get(doc, k), cond):
            return False
    return True


def _project(doc: Mapping[str, Any], proj: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    d = copy.deepcopy(dict(doc))
    if not proj:
        return d
    include = {k for k, v in proj.items() if v and k != "_id"}
    if include:
        out = {k: d[k] for k in include if k in d}
        if proj.get("_id", 1) and "_id" in d:
            out["_id"] = d["_id"]
        return out
    for k, v in proj.items():
        if not v:
            _unset(d, k)
    return d


class _Res:
    def __init__(self, matched: int = 0, modified: int = 0, upserted_id: Any = None, deleted: int = 0,
                 inserted_id: Any = None) -> None:
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_id = upserted_id
        self.deleted_count = deleted
        self.inserted_id = inserted_id


class Cursor:
    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self._rows = rows
        self._limit: Optional[int] = None

    def sort(self, key: Any, direction: int = 1) -> "Cursor":
        keys: Sequence[Tuple[str, int]] = key if isinstance(key, list) else [(key, direction)]
        for k, d in reversed(list(keys)):
            self._rows.sort(key=lambda r: _sortable(_get(r, k)), reverse=d < 0)
        return self

    def limit(self, n: int) -> "Cursor":
        self._limit = n if n else None
        return self

    def skip(self, n: int) -> "Cursor":
        self._rows = self._rows[n:]
        return self

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        rows = self._rows[: self._limit] if self._limit else self._rows
        return rows[:length] if length else rows

    def __aiter__(self) -> "Cursor":
        self._it = iter(self._rows[: self._limit] if self._limit else self._rows)
        return self

    async def __anext__(self) -> Dict[str, Any]:
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _sortable(v: Any) -> Tuple[int, Any]:
    if v is _MISSING or v is None:
        return (0, "")
    if isinstance(v, bool):
        return (1, int(v))
    if isinstance(v, (int, float)):
        return (2, v)
    if isinstance(v, datetime):
        return (3, v.isoformat())
    return (4, str(v))


class Coll:
    def __init__(self, name: str, db: "StubDB") -> None:
        self.name = name
        self.db = db
        self.rows: List[Dict[str, Any]] = []
        self.indexes: Dict[str, Dict[str, Any]] = {"_id_": {"key": [("_id", 1)], "unique": True}}
        self.writes = 0
        self.fail_reads = False

    # ── indexes ──────────────────────────────────────────────────────────
    async def create_index(self, keys: Any, **opts: Any) -> str:
        spec = [(keys, 1)] if isinstance(keys, str) else [tuple(k) for k in keys]
        name = "_".join(f"{k}_{v}" for k, v in spec)
        self.indexes[name] = {"key": spec, **opts}
        return name

    async def index_information(self) -> Dict[str, Any]:
        return copy.deepcopy(self.indexes)

    def _unique_violation(self, doc: Mapping[str, Any], skip: Optional[Mapping[str, Any]] = None) -> Optional[str]:
        for name, ix in self.indexes.items():
            if not ix.get("unique"):
                continue
            fields = [k for k, _ in ix["key"]]
            sparse = ix.get("sparse")
            if len(fields) == 1:
                f = fields[0]
                v = _get(doc, f)
                if v is _MISSING and sparse:
                    continue
                vals = v if isinstance(v, list) else [None if v is _MISSING else v]
                if isinstance(v, list) and not v:
                    continue
                for other in self.rows:
                    if other is skip:
                        continue
                    ov = _get(other, f)
                    if ov is _MISSING and sparse:
                        continue
                    ovals = ov if isinstance(ov, list) else [None if ov is _MISSING else ov]
                    if any(x in ovals for x in vals):
                        return name
            else:
                key = tuple(None if _get(doc, f) is _MISSING else _get(doc, f) for f in fields)
                for other in self.rows:
                    if other is skip:
                        continue
                    if tuple(None if _get(other, f) is _MISSING else _get(other, f) for f in fields) == key:
                        return name
        return None

    # ── reads ────────────────────────────────────────────────────────────
    def _check_read(self) -> None:
        self.db.accessed.append(self.name)
        if self.fail_reads:
            raise RuntimeError("stub read failure")

    def find(self, query: Optional[Mapping[str, Any]] = None, projection: Optional[Mapping[str, Any]] = None,
             **_kw: Any) -> Cursor:
        self._check_read()
        return Cursor([_project(r, projection) for r in self.rows if matches(r, query)])

    async def find_one(self, query: Optional[Mapping[str, Any]] = None, projection: Optional[Mapping[str, Any]] = None,
                       sort: Any = None, **_kw: Any) -> Optional[Dict[str, Any]]:
        self._check_read()
        rows = [r for r in self.rows if matches(r, query)]
        if sort:
            c = Cursor(rows).sort(sort)
            rows = c._rows
        return _project(rows[0], projection) if rows else None

    async def count_documents(self, query: Optional[Mapping[str, Any]] = None) -> int:
        self._check_read()
        return sum(1 for r in self.rows if matches(r, query))

    async def distinct(self, field: str, query: Optional[Mapping[str, Any]] = None) -> List[Any]:
        self._check_read()
        out: List[Any] = []
        for r in self.rows:
            if matches(r, query):
                v = _get(r, field)
                for x in (v if isinstance(v, list) else [v]):
                    if x is not _MISSING and x not in out:
                        out.append(x)
        return out

    # ── writes ───────────────────────────────────────────────────────────
    async def insert_one(self, doc: Mapping[str, Any]) -> _Res:
        self.db.accessed.append(self.name)
        d = copy.deepcopy(dict(doc))
        d.setdefault("_id", f"oid{next(_ids)}")
        if self._unique_violation(d):
            raise DuplicateKeyError("E11000 duplicate key (stub)")
        self.rows.append(d)
        self.writes += 1
        return _Res(inserted_id=d["_id"])

    async def insert_many(self, docs: Iterable[Mapping[str, Any]]) -> _Res:
        for d in docs:
            await self.insert_one(d)
        return _Res()

    def _apply(self, doc: Dict[str, Any], update: Mapping[str, Any], *, inserting: bool) -> None:
        for op, spec in update.items():
            if op == "$set" or (op == "$setOnInsert" and inserting):
                for k, v in spec.items():
                    _set(doc, k, copy.deepcopy(v))
            elif op == "$setOnInsert":
                continue
            elif op == "$unset":
                for k in spec:
                    _unset(doc, k)
            elif op == "$inc":
                for k, v in spec.items():
                    cur = _get(doc, k)
                    _set(doc, k, (0 if cur is _MISSING or cur is None else cur) + v)
            elif op == "$push":
                for k, v in spec.items():
                    cur = _get(doc, k)
                    arr = list(cur) if isinstance(cur, list) else []
                    if isinstance(v, Mapping) and "$each" in v:
                        items = list(v["$each"])
                        pos = v.get("$position")
                        if pos is None:
                            arr.extend(items)
                        else:
                            arr[pos:pos] = items
                        if "$slice" in v:
                            sl = v["$slice"]
                            arr = arr[:sl] if sl >= 0 else arr[sl:]
                    else:
                        arr.append(copy.deepcopy(v))
                    _set(doc, k, arr)
            elif op == "$addToSet":
                for k, v in spec.items():
                    cur = _get(doc, k)
                    arr = list(cur) if isinstance(cur, list) else []
                    items = list(v["$each"]) if isinstance(v, Mapping) and "$each" in v else [v]
                    for it in items:
                        if it not in arr:
                            arr.append(it)
                    _set(doc, k, arr)
            else:
                raise NotImplementedError(op)

    def _seed(self, filt: Mapping[str, Any]) -> Dict[str, Any]:
        base: Dict[str, Any] = {}
        for k, v in filt.items():
            if not k.startswith("$") and not (isinstance(v, Mapping) and any(str(x).startswith("$") for x in v)):
                _set(base, k, copy.deepcopy(v))
        return base

    async def update_one(self, filt: Mapping[str, Any], update: Mapping[str, Any], upsert: bool = False,
                         **_kw: Any) -> _Res:
        self.db.accessed.append(self.name)
        for r in self.rows:
            if matches(r, filt):
                before = copy.deepcopy(r)
                trial = copy.deepcopy(r)
                self._apply(trial, update, inserting=False)
                if self._unique_violation(trial, skip=r):
                    raise DuplicateKeyError("E11000 duplicate key (stub)")
                r.clear()
                r.update(trial)
                self.writes += 1
                return _Res(matched=1, modified=int(before != r))
        if not upsert:
            return _Res()
        d = self._seed(filt)
        self._apply(d, update, inserting=True)
        d.setdefault("_id", f"oid{next(_ids)}")
        if self._unique_violation(d):
            raise DuplicateKeyError("E11000 duplicate key (stub)")
        self.rows.append(d)
        self.writes += 1
        return _Res(upserted_id=d["_id"])

    async def update_many(self, filt: Mapping[str, Any], update: Mapping[str, Any], **_kw: Any) -> _Res:
        self.db.accessed.append(self.name)
        n = 0
        for r in self.rows:
            if matches(r, filt):
                self._apply(r, update, inserting=False)
                n += 1
        self.writes += n
        return _Res(matched=n, modified=n)

    async def find_one_and_update(self, filt: Mapping[str, Any], update: Mapping[str, Any], upsert: bool = False,
                                  return_document: Any = ReturnDocument.BEFORE, **_kw: Any) -> Optional[Dict[str, Any]]:
        self.db.accessed.append(self.name)
        for r in self.rows:
            if matches(r, filt):
                before = copy.deepcopy(r)
                self._apply(r, update, inserting=False)
                self.writes += 1
                return copy.deepcopy(r) if return_document == ReturnDocument.AFTER else before
        if not upsert:
            return None
        d = self._seed(filt)
        self._apply(d, update, inserting=True)
        d.setdefault("_id", f"oid{next(_ids)}")
        if self._unique_violation(d):
            raise DuplicateKeyError("E11000 duplicate key (stub)")
        self.rows.append(d)
        self.writes += 1
        return copy.deepcopy(d) if return_document == ReturnDocument.AFTER else None

    async def delete_one(self, filt: Mapping[str, Any]) -> _Res:
        self.db.accessed.append(self.name)
        for i, r in enumerate(self.rows):
            if matches(r, filt):
                del self.rows[i]
                self.writes += 1
                return _Res(deleted=1)
        return _Res()

    async def delete_many(self, filt: Mapping[str, Any]) -> _Res:
        self.db.accessed.append(self.name)
        keep = [r for r in self.rows if not matches(r, filt)]
        n = len(self.rows) - len(keep)
        self.rows = keep
        self.writes += n
        return _Res(deleted=n)


class StubDB:
    def __init__(self) -> None:
        self._colls: Dict[str, Coll] = {}
        self.accessed: List[str] = []

    def __getattr__(self, name: str) -> Coll:
        if name.startswith("_") or name == "accessed":
            raise AttributeError(name)
        if name not in self._colls:
            self._colls[name] = Coll(name, self)
        return self._colls[name]

    def __getitem__(self, name: str) -> Coll:
        return getattr(self, name)

    def touched(self, name: str) -> bool:
        return name in self.accessed


async def with_event_indexes(db: StubDB) -> StubDB:
    """The unique indexes events_elite.ensure_events_indexes creates (so stubs enforce them)."""
    await db.city_events.create_index("event_id", unique=True)
    await db.city_events.create_index("canonical_key", unique=True)
    await db.city_events.create_index("source_keys", unique=True, sparse=True)
    await db.event_push_log.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.event_reminders_sent.create_index([("user_id", 1), ("event_id", 1)], unique=True)
    await db.event_notif_prefs.create_index("user_id", unique=True)
    return db


# ── server.py slicing (never import server.py: it opens Mongo and loads .env at import) ──

import os as _os
import re as _re

SERVER_PATH = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "server.py")


def server_src() -> str:
    with open(SERVER_PATH, encoding="utf-8") as f:
        return f.read()


def server_block(anchor: str, src: Optional[str] = None) -> str:
    """Top-level block starting at `anchor`, ending at the next two-blank-line gap."""
    s = src if src is not None else server_src()
    i = s.index(anchor)
    j = s.find("\n\n\n", i)
    return s[i:j if j != -1 else None]


def server_span(start_anchor: str, end_anchor: str, src: Optional[str] = None) -> str:
    """Contiguous source from `start_anchor` up to (not including) `end_anchor`."""
    s = src if src is not None else server_src()
    i = s.index(start_anchor)
    j = s.index(end_anchor, i)
    return s[i:j]


_ROUTE_RE = _re.compile(r'^@api_router\.(get|post|put|delete|patch|api_route)\(\s*"([^"]+)"', _re.M)


def api_router_routes(src: Optional[str] = None) -> List[Tuple[str, str, int]]:
    """Every @api_router route in server.py, in registration order: (METHOD, path, offset)."""
    s = src if src is not None else server_src()
    return [(m.group(1).upper(), m.group(2), m.start()) for m in _ROUTE_RE.finditer(s)]
