"""P1-1 (audit 2026-10-01): formula injection in the government CSV exports.

/business/admin/export/users.csv and payments.csv carry user-typed names and
emails; a cell starting with = + - @ \\t \\r is executed as a formula by Excel /
Sheets. _csv_escape now prefixes a leading apostrophe (OWASP neutralisation)
before the ordinary quoting. Source slice — server.py is never imported.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from events_service_stubs import server_block  # noqa: E402

_ns: dict = {}
exec(server_block("def _csv_escape("), _ns)
_csv_escape = _ns["_csv_escape"]


@pytest.mark.parametrize("cell,expected", [
    ("=HYPERLINK(\"http://evil\",\"x\")", "\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\""),
    ("=1+1", "'=1+1"),
    ("+cmd", "'+cmd"),
    ("-2+3", "'-2+3"),
    ("@SUM(A1)", "'@SUM(A1)"),
    ("\tx", "'\tx"),
    ("\rx", "\"'\rx\""),            # CR also triggers the existing quoting
])
def test_formula_triggers_get_a_text_prefix(cell: str, expected: str) -> None:
    assert _csv_escape(cell) == expected


def test_ordinary_cells_are_unchanged() -> None:
    assert _csv_escape(None) == ""
    assert _csv_escape("") == ""
    assert _csv_escape(5) == "5"
    assert _csv_escape("María José") == "María José"
    assert _csv_escape("a,b") == '"a,b"'
    assert _csv_escape('say "hi"') == '"say ""hi"""'
    assert _csv_escape("line\nbreak") == '"line\nbreak"'
    assert _csv_escape("user@example.com") == "user@example.com"   # @ only matters at position 0


def test_prefix_is_applied_before_quoting() -> None:
    out = _csv_escape('=cmd|"calc"!A0')
    assert out.startswith("\"'=") and out == "\"'=cmd|\"\"calc\"\"!A0\""
