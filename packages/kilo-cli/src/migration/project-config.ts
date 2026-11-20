import { constants, Database } from "bun:sqlite"
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** Read directory metadata only. Project files can be tracked or shared with teammates;
 * never rewrite them as a side effect of a machine-wide migration. */
export function assertProjectConfig(locations: Iterable<string>, home: string) {
  assertProjectDirectories(projectDirectories(locations), home)
}

export function assertProjectDirectories(directories: Iterable<string>, home: string) {
  const homeStat = statSync(home, { bigint: true, throwIfNoEntry: false })
  const homeDir = homeStat?.isDirectory() ? realpathSync.native(home) : home
  const issues = [...directories].flatMap((dir) => projectIssues(dir, sameDirectory(dir, homeDir, homeStat)))
  const globalIgnore = path.join(home, ".kilocode", ".kilocodeignore")
  if (lstatSync(globalIgnore, { throwIfNoEntry: false })) issues.push(globalIgnore)
  if (issues.length)
    throw new Error(
      `Reconcile these project resources before switching to kilo names. Preserve ignore rules as read/edit restrictions and move workflows to commands:\n${issues.sort().join("\n")}`,
    )
}

function sameDirectory(dir: string, homeDir: string, homeStat: ReturnType<typeof statSync>) {
  if (dir === homeDir) return true
  if (!homeStat?.isDirectory()) return false
  const st = statSync(dir, { bigint: true, throwIfNoEntry: false })
  if (!st?.isDirectory()) return false
  if (st.ino !== 0n && st.dev === homeStat.dev && st.ino === homeStat.ino) return true
  const real = realpathSync.native(dir)
  return process.platform === "win32" || process.platform === "darwin"
    ? real.toLowerCase() === homeDir.toLowerCase()
    : real === homeDir
}

export function projectDirectories(locations: Iterable<string>) {
  const directories = new Set<string>()
  const primary = new Map<string, string>()
  for (const location of new Set(locations)) {
    if (!path.isAbsolute(location) || !statSync(location, { throwIfNoEntry: false })?.isDirectory()) continue
    const start = realpathSync.native(location)
    for (let dir = start; ; dir = path.dirname(dir)) {
      directories.add(dir)
      const git = lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false })
      if (git) {
        if (!git.isDirectory()) {
          const root = primary.get(dir) ?? primaryCheckout(dir)
          primary.set(dir, root)
          for (let entry = start; ; entry = path.dirname(entry)) {
            directories.add(path.join(root, path.relative(dir, entry)))
            if (entry === dir) break
          }
        }
        break
      }
      if (path.dirname(dir) === dir) break
    }
  }
  return directories
}

function primaryCheckout(dir: string) {
  const proc = Bun.spawnSync(["git", "-C", dir, "worktree", "list", "--porcelain", "-z"], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: 5000,
  })
  const first = proc.stdout.toString().split("\0")[0]
  if (proc.exitCode !== 0 || !first?.startsWith("worktree "))
    throw new Error(`Cannot inspect the primary checkout of ${dir}`)
  return first.slice("worktree ".length)
}

function projectIssues(dir: string, isHome: boolean) {
  const result = [".kilocodeignore"]
    .map((name) => path.join(dir, name))
    .filter((file) => lstatSync(file, { throwIfNoEntry: false }))
  // The global resource planner already migrates these directories under HOME.
  if (isHome) return result
  for (const name of [".kilo/workflows", ".kilocode/workflows", ".kilocode/skills", ".kilocode/skill"]) {
    const file = path.join(dir, name)
    const legacy = lstatSync(file, { throwIfNoEntry: false })
    if (legacy && (!legacy.isDirectory() || readdirSync(file).length)) result.push(file)
  }
  return result
}

/** Only for a standalone file (or a private snapshot). Some of these tables are
 * replaced during conversion, so inventory the old workspace rows before running upstream. */
export function projectLocations(file: string) {
  using db = new Database(
    `${pathToFileURL(file).href}?immutable=1`,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
  )
  const locations = new Set([process.cwd()])
  for (const [table, column] of [
    ["session", "directory"],
    ["session_v2", "directory"],
    ["project", "worktree"],
    ["project_directory", "directory"],
    ["workspace", "directory"],
  ] as const) {
    if (!db.query("SELECT 1 FROM pragma_table_info(?) WHERE name=?").get(table, column)) continue
    for (const row of db
      .query<
        { location: string },
        []
      >(`SELECT DISTINCT ${column} AS location FROM ${table} WHERE ${column} IS NOT NULL`)
      .all())
      locations.add(row.location)
  }
  if (db.query("SELECT 1 FROM pragma_table_info('project') WHERE name='sandboxes'").get()) {
    for (const row of db
      .query<
        { location: string },
        []
      >("SELECT DISTINCT j.value AS location FROM project, json_each(project.sandboxes) j WHERE j.type='text'")
      .all())
      locations.add(row.location)
  }
  return locations
}
