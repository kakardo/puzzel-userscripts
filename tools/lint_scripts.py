# @file_name = lint_scripts.py
# @author = Kardo Rostam
# @version = 1.0_2026-08-27
# @created = 2026-08-27 06:20

# Lints every userscript against the repo rules (LLM_prompt_instructions):
#   - metadata block: @file_name matches the real filename, @author, @version
#     in X.Y_YYYY-MM-DD format with a single-digit minor, @created present
#   - uniform ==UserScript== block: fixed key order, shared @namespace,
#     both @version fields identical, @downloadURL/@updateURL matching the
#     file's actual repo path (DOM library exempt: it has no block)
#   - no em dashes or en dashes anywhere (also checked in .md and .yml)
#   - with --check-bump (CI): changed scripts must have a bumped @version,
#     and a changed DOM library must be accompanied by bumps in every
#     script that requires it
#
# Usage: python3 tools/lint_scripts.py [--check-bump]

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = "https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/"
NAMESPACE = "https://github.com/kakardo/puzzel-userscripts"
AUTHOR = "Kardo Rostam"
VERSION_RE = re.compile(r"^\d+\.\d_\d{4}-\d{2}-\d{2}$")
DASHES = "–—"
BLOCK_KEY_ORDER = ["name", "namespace", "version", "description", "author",
                   "match", "run-at", "require", "grant", "downloadURL", "updateURL"]
OPTIONAL_KEYS = {"require"}
LIB_RELPATH = "DOM/PCM_DOM_Shared_Local.user.js"

errors = []


def err(path, message):
    errors.append(path + ": " + message)


def repo_files(extensions):
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            if any(name.endswith(ext) for ext in extensions):
                full = os.path.join(dirpath, name)
                yield os.path.relpath(full, ROOT).replace(os.sep, "/")


def read(relpath):
    with open(os.path.join(ROOT, relpath), encoding="utf-8") as fh:
        return fh.read()


def meta_value(lines, label):
    prefix = "// @" + label + " = "
    for line in lines:
        if line.startswith(prefix):
            return line[len(prefix):].strip()
        if line.strip() == "// ==UserScript==":
            break
    return None


def check_dashes(relpath, content):
    for index, line in enumerate(content.split("\n"), 1):
        if any(ch in line for ch in DASHES):
            err(relpath, "em or en dash on line %d" % index)


def parse_block(lines):
    try:
        start = lines.index("// ==UserScript==")
        end = lines.index("// ==/UserScript==")
    except ValueError:
        return None, None, None
    entries = []
    for line in lines[start + 1:end]:
        match = re.match(r"^// @([A-Za-z-]+)\s+(.*)$", line)
        if match:
            entries.append((match.group(1), match.group(2).strip()))
    return start, end, entries


def check_userscript(relpath):
    content = read(relpath)
    check_dashes(relpath, content)
    lines = content.split("\n")

    filename = relpath.split("/")[-1]
    fn = meta_value(lines, "file_name")
    if fn != filename:
        err(relpath, "@file_name is %r, expected %r" % (fn, filename))
    if meta_value(lines, "author") != AUTHOR:
        err(relpath, "metadata @author missing or wrong")
    version = meta_value(lines, "version")
    if not version or not VERSION_RE.match(version):
        err(relpath, "metadata @version %r does not match X.Y_YYYY-MM-DD" % version)
    if not meta_value(lines, "created"):
        err(relpath, "metadata @created missing")

    if relpath == LIB_RELPATH:
        return  # library has no ==UserScript== block by design

    start, end, entries = parse_block(lines)
    if start is None:
        err(relpath, "missing ==UserScript== block")
        return

    keys = [key for key, _ in entries]
    values = dict(entries)  # last wins; fine for single-value keys checked below

    # Fixed key order (repeated keys like match/grant must stay grouped)
    order_positions = []
    for key in keys:
        if key not in BLOCK_KEY_ORDER:
            err(relpath, "unexpected block key @" + key)
            continue
        order_positions.append(BLOCK_KEY_ORDER.index(key))
    if order_positions != sorted(order_positions):
        err(relpath, "block keys out of the fixed order")

    for required in ["name", "namespace", "version", "description", "author",
                     "match", "run-at", "grant", "downloadURL", "updateURL"]:
        if required not in keys:
            err(relpath, "block missing @" + required)

    if values.get("namespace") != NAMESPACE:
        err(relpath, "@namespace is %r, expected %r" % (values.get("namespace"), NAMESPACE))
    if values.get("author") != AUTHOR:
        err(relpath, "block @author missing or wrong")
    if values.get("version") != version:
        err(relpath, "block @version %r differs from metadata %r" % (values.get("version"), version))
    if values.get("run-at") != "document-idle":
        err(relpath, "@run-at must be document-idle")

    expected_url = RAW + relpath
    for key in ("downloadURL", "updateURL"):
        if key in values and values[key] != expected_url:
            err(relpath, "@%s is %r, expected %r" % (key, values[key], expected_url))


def head_parent_exists():
    result = subprocess.run(["git", "rev-parse", "--verify", "HEAD^"],
                            cwd=ROOT, capture_output=True, text=True)
    return result.returncode == 0


def git_show(ref, relpath):
    result = subprocess.run(["git", "show", ref + ":" + relpath],
                            cwd=ROOT, capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def check_bumps():
    if not head_parent_exists():
        print("bump check skipped: no parent commit")
        return
    result = subprocess.run(["git", "diff", "--name-only", "HEAD^", "HEAD"],
                            cwd=ROOT, capture_output=True, text=True)
    changed = [line for line in result.stdout.split("\n") if line.endswith(".user.js")]

    for relpath in changed:
        old = git_show("HEAD^", relpath)
        if old is None:
            continue  # new file
        new = git_show("HEAD", relpath)
        if new is None:
            continue  # deleted file
        old_version = meta_value(old.split("\n"), "version")
        new_version = meta_value(new.split("\n"), "version")
        if old_version == new_version:
            err(relpath, "changed without bumping @version (still %r)" % new_version)

    if LIB_RELPATH in changed:
        for relpath in repo_files([".user.js"]):
            if relpath == LIB_RELPATH:
                continue
            if LIB_RELPATH in read(relpath) and relpath not in changed:
                err(relpath, "requires the DOM library, which changed, but was not bumped in the same commit")


def main():
    for relpath in repo_files([".user.js"]):
        check_userscript(relpath)
    for relpath in repo_files([".md", ".yml"]):
        check_dashes(relpath, read(relpath))

    if "--check-bump" in sys.argv:
        check_bumps()

    if errors:
        print("LINT FAILED (%d problems):" % len(errors))
        for problem in errors:
            print("  " + problem)
        sys.exit(1)

    print("LINT OK")


if __name__ == "__main__":
    main()
