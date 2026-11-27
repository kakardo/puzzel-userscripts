# @file_name = lint_scripts.py
# @author = Kardo Rostam
# @version = 1.4_2026-11-27
# @created = 2026-08-27 06:20

# Lints every userscript against the repo rules:
#   - the file starts with the ==UserScript== block: fixed key order, shared
#     @namespace, @author, @version in X.Y_YYYY-MM-DD format with a
#     single-digit minor, and @downloadURL matching the file's actual repo
#     path (which also covers the file name). No @updateURL: Tampermonkey
#     checks @downloadURL for updates when it is missing.
#   - right under the block, after one blank line: // @created = ..., then
#     any // @note = ... (or // @dependency = ...) lines directly below it,
#     then a blank line before the code. These labels appear nowhere else.
#   - @run-at document-idle; document-start only with an @note that
#     explains why (for scripts that must act before the page's own code)
#   - the shared library has no ==UserScript== block, so it keeps the
#     labels at the top instead: @file_name, @author, @version, @created
#   - no em dashes or en dashes anywhere (also checked in .md and .yml)
#   - with --check-bump (CI): changed scripts must have a bumped @version.
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
DASHES = "\u2013\u2014"
BLOCK_KEY_ORDER = ["name", "namespace", "version", "description", "author",
                   "match", "run-at", "require", "grant", "downloadURL"]
OPTIONAL_KEYS = {"require"}
REQUIRED_KEYS = [key for key in BLOCK_KEY_ORDER if key not in OPTIONAL_KEYS]
LABEL_RE = re.compile(r"^// @([A-Za-z_]+) = ")
UNDER_BLOCK_LABELS = {"note", "dependency"}
LIB_RELPATH = "PCM_Shared_Library/PCM_Shared_Library.user.js"

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


def version_of(content):
    """The @version of a file: from its block, or from the top labels
    (the shared library, and files from before 1.4)."""
    lines = content.split("\n")
    start, end, entries = parse_block(lines)
    if entries:
        for key, value in entries:
            if key == "version":
                return value
    return meta_value(lines, "version")


def check_library(relpath, lines):
    if meta_value(lines, "file_name") != relpath.split("/")[-1]:
        err(relpath, "@file_name missing or not the real file name")
    if meta_value(lines, "author") != AUTHOR:
        err(relpath, "@author missing or wrong")
    version = meta_value(lines, "version")
    if not version or not VERSION_RE.match(version):
        err(relpath, "@version %r does not match X.Y_YYYY-MM-DD" % version)
    if not meta_value(lines, "created"):
        err(relpath, "@created missing")


def check_under_block(relpath, lines, end):
    """@created, then the notes, right under the block."""
    rest = lines[end + 1:]
    if len(rest) < 2 or rest[0] != "" or not rest[1].startswith("// @created = "):
        err(relpath, "@created must follow the block after one blank line")
        return []
    group = []
    for line in rest[2:]:
        match = LABEL_RE.match(line)
        if not match:
            break
        if match.group(1) not in UNDER_BLOCK_LABELS:
            err(relpath, "unexpected label @%s under the block" % match.group(1))
        group.append(line)
    after = 2 + len(group)
    if after < len(rest) and rest[after] != "":
        err(relpath, "a blank line must follow the notes, before the code")
    expected = 1 + len(group)
    found = sum(1 for line in lines if LABEL_RE.match(line))
    if found != expected:
        err(relpath, "@created and @note lines must sit together, @created first, "
                     "right under the block, and nowhere else")
    return group


def check_userscript(relpath):
    content = read(relpath)
    check_dashes(relpath, content)
    lines = content.split("\n")

    if relpath == LIB_RELPATH:
        check_library(relpath, lines)
        return  # library has no ==UserScript== block by design

    start, end, entries = parse_block(lines)
    if start is None:
        err(relpath, "missing ==UserScript== block")
        return
    if start != 0:
        err(relpath, "the file must start with the ==UserScript== block")

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

    for required in REQUIRED_KEYS:
        if required not in keys:
            err(relpath, "block missing @" + required)

    if values.get("namespace") != NAMESPACE:
        err(relpath, "@namespace is %r, expected %r" % (values.get("namespace"), NAMESPACE))
    if values.get("author") != AUTHOR:
        err(relpath, "@author missing or wrong")
    version = values.get("version")
    if not version or not VERSION_RE.match(version):
        err(relpath, "@version %r does not match X.Y_YYYY-MM-DD" % version)

    notes = check_under_block(relpath, lines, end)
    run_at = values.get("run-at")
    explained_start = any(line.startswith("// @note = ") and "document-start" in line for line in notes)
    if run_at == "document-start" and not explained_start:
        err(relpath, "@run-at document-start needs an @note explaining why")
    elif run_at not in ("document-idle", "document-start"):
        err(relpath, "@run-at must be document-idle")

    expected_url = RAW + relpath
    if "downloadURL" in values and values["downloadURL"] != expected_url:
        err(relpath, "@downloadURL is %r, expected %r" % (values["downloadURL"], expected_url))


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
        old_version = version_of(old)
        new_version = version_of(new)
        if old_version == new_version:
            err(relpath, "changed without bumping @version (still %r)" % new_version)


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
