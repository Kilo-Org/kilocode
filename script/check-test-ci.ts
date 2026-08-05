// kilocode_change - new file
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const proc = Bun.spawnSync(["git", "ls-files", "packages"], {
  cwd: root,
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
})
if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || "Unable to list tracked package tests")

const exempt = new Set(["packages/kilo-vscode"])
const dirs = new Set(
  proc.stdout
    .toString()
    .split("\n")
    .filter((file) => /\.test\.tsx?$/.test(file))
    .map((file) => file.split("/").slice(0, 2).join("/")),
)
const missing: string[] = []

for (const dir of [...dirs].sort()) {
  if (exempt.has(dir)) continue
  const file = path.join(root, dir, "package.json")
  const source = Bun.file(file)
  if (!(await source.exists())) continue
  const pkg = (await source.json()) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts
  if (!scripts?.test && !scripts?.["test:ci"]) continue
  if (!scripts["test:ci"]) missing.push(`${dir}/package.json`)
}

if (missing.length > 0) throw new Error(`Test-bearing packages missing test:ci:\n${missing.join("\n")}`)
console.log(`check-test-ci: ok (${dirs.size - exempt.size} test-bearing package(s))`)
