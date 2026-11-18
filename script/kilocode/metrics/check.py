"""Run from the repository root: python3 script/kilocode/metrics/check.py [base]"""

import difflib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def git(*args):
    return subprocess.check_output(["git", *args]).decode()


def product(path):
    return (
        re.match(
            r"packages/(?:kilo-[^/]+/src/|kilo-vscode/webview-ui/|.+/src/kilocode/)",
            path,
        )
        and re.search(r"\.tsx?$", path)
        and not re.search(r"\.(?:test|spec|stories|d|gen|generated)\.tsx?$", path)
        and not re.search(
            r"/(?:kilo-i18n|i18n|locales|translations|language-dictionaries|tests?|__tests__|__fixtures__|fixtures?|stories|examples|generated|vendor|continuedev)/",
            path,
        )
    )


def measure(folder, sources, binary):
    if not sources:
        return {}
    folder.mkdir()
    for name, text in sources.items():
        file = folder / name
        file.parent.mkdir(parents=True, exist_ok=True)
        # Inline disables belong to the project lint run, not the independent metric.
        file.write_text(re.sub(r"(?:eslint|oxlint)-disable", "metric-disable", text))
    config = {
        "categories": {"correctness": "off"},
        "rules": {"complexity": ["error", 20]},
    }
    (folder / "config.json").write_text(json.dumps(config))
    result = subprocess.run(
        [binary, "-c", "config.json", "-f", "json", "--no-ignore", "packages"],
        cwd=folder,
        stdout=subprocess.PIPE,
        text=True,
    )
    report = json.loads(result.stdout)
    if report["number_of_files"] != len(sources) or result.returncode not in (0, 1):
        raise RuntimeError("Oxlint did not measure the complete source snapshot")
    scores = {}
    for finding in report["diagnostics"]:
        match = re.fullmatch(
            r"(.+) has a complexity of (\d+)\. Maximum allowed is 20\.",
            finding["message"],
        )
        if not match or finding.get("code") != "eslint(complexity)":
            raise RuntimeError(f"{finding['filename']}: {finding['message']}")
        span = finding["labels"][0]["span"]
        scores.setdefault(finding["filename"], {})[
            span["line"], span["column"], match[1]
        ] = int(match[2])
    return scores


def compare(name, old, new, before, after):
    cap = max(1000, len(old))
    if len(new) > cap:
        yield f"{name}: {len(new)} lines (limit {cap}). Extract a cohesive responsibility into its own module."
    if not after:
        return
    # Only an unchanged declaration line at a mapped position can inherit debt.
    # Do not pool scores across callbacks, classes, or functions with the same name.
    positions = {}
    for a, b, count in difflib.SequenceMatcher(
        None, old, new, autojunk=False
    ).get_matching_blocks():
        positions.update((b + i + 1, a + i + 1) for i in range(count))
    for (line, col, label), score in after.items():
        allowed = before.get((positions.get(line), col, label), 20)
        if score > allowed:
            yield f"{name}:{line}:{col}: {label} complexity {score} (limit {allowed}). Separate a decision or dispatch path and test it independently."


def check(base, binary):
    changed = git(
        "diff",
        "--no-renames",
        "--diff-filter=AMT",
        "--name-only",
        "-z",
        base,
        "--",
        "packages",
    ).split("\0")
    untracked = git(
        "ls-files", "--others", "--exclude-standard", "-z", "--", "packages"
    ).split("\0")
    registry = json.loads(Path("script/upstream/mirrors.json").read_text())
    mirrors = {entry["mirror"] for entry in registry["mirrors"].values()}
    names = sorted(
        name
        for name in set(changed + untracked)
        if product(name) and name not in mirrors
    )
    originals = (
        set(git("ls-tree", "-rz", "--name-only", base, "--", "packages").split("\0"))
        if names
        else set()
    )
    before = {
        name: git("show", f"{base}:{name}") for name in names if name in originals
    }
    after = {}
    for name in names:
        if Path(name).is_symlink():
            raise ValueError(f"Cannot measure symbolic link: {name}")
        after[name] = Path(name).read_text()
    with tempfile.TemporaryDirectory() as tmp:
        old = measure(Path(tmp, "before"), before, binary)
        new = measure(Path(tmp, "after"), after, binary)
    errors = [
        message
        for name in names
        for message in compare(
            name,
            before.get(name, "").splitlines(),
            after[name].splitlines(),
            old.get(name, {}),
            new.get(name, {}),
        )
    ]
    for message in errors:
        print(f"ERROR {message}", file=sys.stderr)
    print(
        f"Kilo metrics: {len(names)} changed source files, {len(errors)} regressions."
    )
    return bool(errors)


if __name__ == "__main__":
    base = (
        sys.argv[1]
        if len(sys.argv) > 1
        else git("merge-base", "origin/v2", "HEAD").strip()
    )
    sys.exit(check(base, Path("node_modules/.bin/oxlint").absolute()))
