// kilocode_change - new file
//
// Refreshes the committed sharding weights (`script/kilocode/test-durations.json`)
// from JUnit XML produced by CI.
//
//   bun script/kilocode/update-test-durations.ts <junit-file-or-dir> [...more]
//
// The committed file is the ONLY run-to-run-variable input the shard splitter
// reads. Every shard job computes the full split independently, so the weights
// must be byte-identical on every shard of a run; that is why CI never feeds
// live history into the sharder and refreshing is an explicit, reviewable
// commit instead (see the note in .github/workflows/test.yml). The `aggregate
// junit history` job runs this against the per-OS aggregates and uploads the
// result as the `test-durations-refresh` artifact; download it and commit the
// json when the suite has drifted enough for balance to suffer.
//
// Merge policy, per file:
//   - several inputs this refresh (e.g. aggregate-Linux.xml and
//     aggregate-Windows.xml): the MAX wins, matching DURATION_HINTS being
//     observed maxima — the slowest OS is the one shard balance must survive.
//   - fresh vs committed: fresh REPLACES committed, so a file that got faster
//     stops hogging weight; files not measured this refresh keep their entry.
//   - entries whose test file no longer exists are dropped.
// Values are seconds, matching the runner's weight units.

import * as fs from "fs"
import * as path from "path"
import { JunitDurations } from "./junit-durations"
import { TestShard } from "./test-shard"

const root = path.resolve(import.meta.dir, "..", "..")
const target = path.join(root, "script", "kilocode", "test-durations.json")

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error("usage: update-test-durations.ts <junit-file-or-dir> [...more]")
  process.exit(2)
}

function xmlFiles(entry: string): string[] {
  const stat = fs.statSync(entry, { throwIfNoEntry: false })
  if (!stat) {
    console.error(`warn: ${entry} does not exist; skipping`)
    return []
  }
  if (stat.isFile()) return entry.endsWith(".xml") ? [entry] : []
  return fs
    .readdirSync(entry, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith(".xml"))
    .map((dirent) => path.join(dirent.parentPath, dirent.name))
}

const sources = inputs.flatMap(xmlFiles)
const fresh = TestShard.combineDurations(...sources.map((file) => JunitDurations.parse(fs.readFileSync(file, "utf8"))))

const committed: Record<string, number> = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {}

const merged = Object.fromEntries(
  Object.entries({ ...committed, ...roundAll(fresh) })
    .filter(([file]) => fs.existsSync(path.join(root, "test", file)))
    .sort(([a], [b]) => a.localeCompare(b)),
)

fs.writeFileSync(target, JSON.stringify(merged, null, 1) + "\n")
console.log(
  `updated ${path.relative(root, target)}: ${Object.keys(fresh).length} measured from ${sources.length} junit file(s), ${Object.keys(merged).length} total`,
)

function roundAll(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).map(([file, time]) => [file, Math.round(time * 10) / 10]))
}
