#!/usr/bin/env python3
"""
Apply autoTr wrapping to React Native screens.

For each .tsx file in app/ and src/components/:
  1. Add `import { useTr } from '<...>/src/i18n/autoTr';` if not present
  2. Insert `const tr = useTr();` after the first hook call (useAuth/useState etc.) inside the component
  3. Find every <Text>...</Text> with hardcoded Spanish content and wrap it: <Text>{tr('...')}</Text>
  4. Wrap common props: placeholder="...", title: '...' that match dict keys

This is conservative — it only wraps strings that exist in AUTO_TR dict.
We read autoTr.ts to extract the keys, so any new key automatically picks up.
"""
import re
import os
import sys
from pathlib import Path

FRONTEND = Path("/app/frontend")
AUTOTR_FILE = FRONTEND / "src/i18n/autoTr.ts"


def load_keys():
    text = AUTOTR_FILE.read_text(encoding="utf-8")
    # Match keys of the form  'something':  or  "something":
    keys = set()
    for m in re.finditer(r"^\s*'([^']+)':\s*\{", text, flags=re.MULTILINE):
        keys.add(m.group(1))
    for m in re.finditer(r'^\s*"([^"]+)":\s*\{', text, flags=re.MULTILINE):
        keys.add(m.group(1))
    return keys


def import_path_for(file_path: Path) -> str:
    """Compute relative path from file -> src/i18n/autoTr"""
    target = FRONTEND / "src/i18n/autoTr"
    rel = os.path.relpath(target, file_path.parent).replace(os.sep, "/")
    if not rel.startswith("."):
        rel = "./" + rel
    return rel


def process_file(file_path: Path, keys: set) -> bool:
    text = file_path.read_text(encoding="utf-8")
    original = text

    # Skip files we already know not to touch
    if "autoTr" in text:  # already imported
        already = True
    else:
        already = False

    # 1) Wrap Spanish strings in <Text>SPAN</Text> like patterns
    # We only wrap when the text is between > and < tags (JSX text node)
    # and the content (stripped) matches one of our keys.
    def wrap_jsx_text(match: re.Match) -> str:
        pre = match.group(1)
        content = match.group(2)
        post = match.group(3)
        stripped = content.strip()
        if stripped in keys:
            indent = pre  # preserve indent
            return f"{pre}{{tr({_quote(stripped)})}}{post}"
        return match.group(0)

    text = re.sub(
        r"(>[\s]*)([^<>{}\n]+?)([\s]*<)",
        wrap_jsx_text,
        text,
    )

    # 2) Wrap placeholder="..." and title: '...' attribute strings (object literals & JSX attrs)
    def wrap_attr(match: re.Match) -> str:
        attr = match.group(1)
        quote = match.group(2)
        content = match.group(3)
        if content in keys:
            return f"{attr}={{tr({_quote(content)})}}"
        return match.group(0)

    text = re.sub(
        r'(placeholder|label|title)=(")([^"\n]+)\2',
        wrap_attr,
        text,
    )

    # 3) If we changed something, inject import + hook
    if text != original:
        # Ensure import
        if "from '" not in text or "autoTr" not in text:
            # Find last import line
            lines = text.split("\n")
            last_import_idx = -1
            for i, ln in enumerate(lines):
                if ln.startswith("import "):
                    last_import_idx = i
            if last_import_idx >= 0:
                rel = import_path_for(file_path)
                new_import = f"import {{ useTr }} from '{rel}';"
                if new_import not in text:
                    lines.insert(last_import_idx + 1, new_import)
            text = "\n".join(lines)

        # Inject `const tr = useTr();` inside the default export component function
        # Heuristic: find `export default function ...() {` and insert after the opening brace
        if "const tr = useTr();" not in text:
            func_pat = re.compile(
                r"(export default function\s+\w+\s*\([^)]*\)\s*\{)",
                re.MULTILINE,
            )
            m = func_pat.search(text)
            if m:
                end = m.end()
                text = text[:end] + "\n  const tr = useTr();" + text[end:]

    if text != original:
        file_path.write_text(text, encoding="utf-8")
        return True
    return False


def _quote(s: str) -> str:
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    return "`" + s.replace("`", "\\`") + "`"


def main():
    keys = load_keys()
    print(f"Loaded {len(keys)} translation keys")
    targets = []
    for sub in ["app", "src/components"]:
        targets.extend((FRONTEND / sub).rglob("*.tsx"))
    skip = {"_layout.tsx"}  # already manually translated
    changed = []
    for f in targets:
        if f.name in skip:
            continue
        # Skip already-translated screens
        rel = str(f.relative_to(FRONTEND))
        try:
            if process_file(f, keys):
                changed.append(rel)
        except Exception as e:
            print(f"  ! {rel}: {e}")
    print(f"Modified {len(changed)} files:")
    for c in changed:
        print(f"  - {c}")


if __name__ == "__main__":
    main()
