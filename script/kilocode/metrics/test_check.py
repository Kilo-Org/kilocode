"""Exercise the same Git comparison and pinned Oxlint binary CI uses."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


def function(name, branches):
    body = "".join(f"  if (x === {i}) return {i}\n" for i in range(branches))
    return f"export function {name}(x: number) {{\n{body}  return -1\n}}\n"


class MetricGate(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.source = self.root / "packages/kilo-example/src/old.ts"
        self.source.parent.mkdir(parents=True)
        self.source.write_text(function("legacy", 22))
        registry = self.root / "script/upstream/mirrors.json"
        registry.parent.mkdir(parents=True)
        registry.write_text(
            '{"mirrors":{"upstream.ts":{"mirror":"packages/kilo-example/src/copy.ts"}}}'
        )
        (self.root / "node_modules").symlink_to(
            ROOT / "node_modules", target_is_directory=True
        )
        self.git("init", "-q")
        self.git("add", "packages", "script")
        self.commit()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def commit(self):
        self.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qam",
            "base",
        )

    def gate(self, code):
        result = subprocess.run(
            [sys.executable, ROOT / "script/kilocode/metrics/check.py", "HEAD"],
            cwd=self.root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, code, result.stderr)
        return result.stderr

    def test_smaller_score_is_next_ceiling(self):
        self.source.write_text("// offset\n" + function("legacy", 20))
        self.gate(0)
        self.commit()
        self.source.write_text(function("legacy", 21))
        self.assertIn("complexity 22 (limit 21)", self.gate(1))

    def test_new_function_cannot_spend_removed_debt(self):
        self.source.write_text(
            "// oxlint-disable-next-line complexity\n" + function("replacement", 20)
        )
        self.assertIn("complexity 21 (limit 20)", self.gate(1))

    def test_unicode_separators_in_string_do_not_move_declaration(self):
        self.source.write_text(
            'const prefix = "a\u2028b\u2029c"\n' + function("legacy", 22),
            encoding="utf-8",
        )
        self.gate(0)

    def test_file_growth_and_excluded_sources(self):
        large = "// line\n" * 1001
        for name in ("old.test.ts", "copy.ts", "contract.generated.ts"):
            self.source.with_name(name).write_text(large)
        self.gate(0)
        new = self.source.with_name("new.tsx")
        new.write_text(large)
        self.assertIn("1001 lines (limit 1000)", self.gate(1))
        self.git("add", str(new))
        self.commit()
        new.write_text(large + "// extra\n")
        self.assertIn("1002 lines (limit 1001)", self.gate(1))


if __name__ == "__main__":
    unittest.main()
