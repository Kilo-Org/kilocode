import { constants, Database } from "bun:sqlite"
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  credentialRows,
  equivalentCredentials,
  installCredentials,
  type CredentialAliases,
} from "./preview-credentials"

/** Run on the closed, private conversion, before activation. Choose a whole store only if it already contains
 * every other store. A union of independently valid rows need not be a valid session or sync history. */
export function reconcilePreview(target: string, previews: string[], originalCredentialIDs?: ReadonlySet<string>) {
  if (!previews.length) return
  const converted = inspect(target)
  const others = [...new Set(previews)].map(inspect)
  for (const preview of others) {
    if (preview.identity === converted.identity) throw new Error(`Preview ${preview.file} aliases candidate ${target}`)
    requireCompatible(converted, preview)
  }

  // A superset cannot have fewer rows. On a tie prefer the conversion. Check containment, including every
  // unknown/plugin table, before trusting this choice; session counts alone don't say which store to use.
  const stores = [converted, ...others].map(validate)
  const best = stores.reduce((a, b) => (a.rows >= b.rows ? a : b)).store
  const aliases: CredentialAliases = new Map()
  for (const { store } of stores) {
    if (store !== best) requireContained(store, best, aliases, store === converted ? originalCredentialIDs : undefined)
  }
  const verify = () => {
    for (const { store } of stores) {
      if (stamp(store.file).version !== store.version)
        throw new Error(`${store.file} changed during reconciliation. Close all Kilo clients and retry.`)
    }
  }
  if (best === converted) verify()
  else copyPreview(best.file, target, verify)
  if (aliases.size) {
    using db = new Database(target, { readwrite: true, create: false })
    installCredentials(db, aliases, best === converted ? originalCredentialIDs : undefined)
  }
}

function copyPreview(file: string, target: string, verify: () => void) {
  // Do not link an original into the candidate: later writes would reach the original inode. The scratch
  // directory protects credentials even when the preview file's permissions are wider than the candidate's.
  const dir = mkdtempSync(path.join(path.dirname(target), ".reconcile-"))
  try {
    const copy = path.join(dir, "candidate.db")
    copyFileSync(file, copy)
    chmodSync(copy, 0o600)
    verify()
    for (const suffix of sidecars) rmSync(target + suffix, { force: true })
    renameSync(copy, target)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// An immutable read creates no files, including in WAL mode, but ignores WAL frames and hot rollback journals.
// Refuse either, and recheck file identity, timestamps and sidecars after reading/copying.
const sidecars = ["-wal", "-shm", "-journal"] as const

function stamp(file: string) {
  const stat = lstatSync(file, { bigint: true })
  if (!stat.isFile()) throw new Error(`Expected a regular store file at ${file}; resolve links before migrating.`)
  const metadata = sidecars.map((suffix) => {
    const sidecar = lstatSync(file + suffix, { bigint: true, throwIfNoEntry: false })
    if (!sidecar) return "absent"
    // macOS can keep an empty WAL and its disposable shared-memory index after the final close.
    if (!sidecar.isFile() || (suffix !== "-shm" && sidecar.size !== 0n))
      throw new Error(`Found ${file + suffix}. Close all clients using ${file} and let SQLite finish recovery first.`)
    return `${sidecar.dev}:${sidecar.ino}:${sidecar.size}:${sidecar.mtimeNs}:${sidecar.ctimeNs}`
  })
  const identity = `${stat.dev}:${stat.ino}`
  const revision = `${identity}:${stat.size}:${stat.mtimeNs}`
  return { identity, revision, version: `${revision}:${stat.ctimeNs}:${metadata.join("|")}` }
}

export function previewRevisions(files: string[]) {
  return Object.fromEntries(files.map((file) => [file, stamp(file).revision]))
}

function uri(file: string) {
  return `${pathToFileURL(path.resolve(file)).href}?mode=ro&immutable=1`
}

function open(file: string) {
  const db = new Database(uri(file), constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI)
  db.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON")
  return db
}

type Entry = { type: string; name: string; sql: string | null }
type Store = ReturnType<typeof inspect>

function inspect(file: string) {
  const state = stamp(file)
  try {
    using db = open(file)
    const schema = db.query<Entry, []>("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all()
    const tables = db
      .query<{ name: string; type: string; wr: number }, []>("PRAGMA main.table_list")
      .all()
      .filter((table) => table.name !== "sqlite_schema" && table.type !== "view")
    const unsupported = tables.find((table) => table.type !== "table")
    if (unsupported) throw new Error(`unsupported ${unsupported.type} table ${unsupported.name}`)
    if (schema.length && !tables.some((table) => table.name === "session_v2"))
      throw new Error("not a converted v2 store")
    const header = ["application_id", "user_version", "encoding"].map(
      (key) => db.query<Record<string, string | number>, []>(`PRAGMA ${key}`).get()![key],
    )
    return { file, ...state, schema, tables, header }
  } catch (error) {
    throw new Error(
      `Cannot inspect ${file}: ${error instanceof Error ? error.message : error}. Check the store before migrating.`,
    )
  }
}

function validate(store: Store) {
  using db = open(store.file)
  if (db.query<{ integrity_check: string }, []>("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok")
    throw new Error(`SQLite integrity failure: ${store.file}`)
  if (db.query("PRAGMA foreign_key_check").get()) throw new Error(`Broken foreign key references: ${store.file}`)
  const rows = store.tables.reduce(
    (n, table) => n + db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${quote(table.name)}`).get()!.n,
    0,
  )
  return { store, rows }
}

function requireCompatible(converted: Store, preview: Store) {
  if (!converted.tables.some((table) => table.name === "session_v2"))
    throw new Error(`Not a v2 candidate: ${converted.file}`)
  if (preview.header.some((value, i) => value !== converted.header[i]))
    conflict(preview, converted, "different SQLite application ID, user version or encoding")
  // Extra tables on the conversion (e.g. retained legacy tables) are fine as long as the selected store
  // also preserves them. Don't promote unrecognized schema objects, triggers, or an incompatible column layout.
  for (const entry of preview.schema) {
    if (!converted.schema.some((other) => same(entry, other)))
      conflict(preview, converted, `unknown or different schema for ${entry.type} ${quote(entry.name)}`)
  }
  if (preview.tables.some((table) => table.name === "migration")) {
    using db = open(preview.file)
    db.run("ATTACH DATABASE ? AS converted", [uri(converted.file)])
    if (db.query("SELECT id FROM main.migration EXCEPT SELECT id FROM converted.migration LIMIT 1").get())
      conflict(preview, converted, "preview has migrations this conversion does not recognize")
  }
}

function same(a: Entry, b: Entry) {
  return (
    a.type === b.type &&
    a.name === b.name &&
    (a.sql === b.sql ||
      (a.type === "table" && bootstrapTables.has(a.name) && tableDefinition(a) === tableDefinition(b)))
  )
}

// Only the known bootstrap tables get DDL normalization. Plugin objects and
// future schema additions must match exactly until their semantics are reviewed.
const bootstrapTables = new Set([
  "account_state",
  "account",
  "control_account",
  "automation",
  "credential",
  "event_sequence",
  "event",
  "job",
  "kv",
  "permission",
  "project_directory",
  "project",
  "blob_ref",
  "blob",
  "instruction_blob",
  "instruction_entry",
  "instruction_state",
  "session_inbox",
  "session_message",
  "session_part",
  "session_v2",
  "workspace",
  "worktree",
  "migration",
])

// Bootstrap and incremental migrations indent the same DDL differently. Compare
// tokens, not stripped text: quoted defaults and identifier boundaries are significant.
function tableDefinition(entry: Entry) {
  const tokens = entry.sql?.match(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[\w$]+|[^\s]/g,
  )
  if (!tokens || tokens[0] !== "CREATE" || tokens[1] !== "TABLE" || tokens[3] !== "(") return entry.sql
  // SQLite quotes the table name after ALTER TABLE. The schema entry already
  // identifies that name. ALTER ADD also appends columns rather than reordering.
  const columns: string[] = []
  const constraints: string[] = []
  let part: string[] = []
  let depth = 0
  for (const [i, token] of tokens.entries()) {
    if (i < 4) continue
    if (!depth && (token === "," || token === ")")) {
      const target = /^(?:CONSTRAINT|CHECK|FOREIGN|PRIMARY|UNIQUE)$/i.test(part[0] ?? "") ? constraints : columns
      target.push(JSON.stringify(part))
      part = []
      if (token === ")")
        return JSON.stringify([
          ["automation", "event", "project", "session_v2"].includes(entry.name) ? columns.sort() : columns,
          constraints,
          tokens.slice(i + 1),
        ])
      continue
    }
    if (token === "(") depth++
    if (token === ")") depth--
    part.push(token)
  }
  return entry.sql
}

function requireContained(source: Store, best: Store, aliases: CredentialAliases, originalIDs?: ReadonlySet<string>) {
  for (const entry of source.schema) {
    if (!best.schema.some((other) => same(entry, other)))
      conflict(source, best, `missing schema for ${entry.type} ${quote(entry.name)}`)
  }
  using db = open(source.file)
  db.run("ATTACH DATABASE ? AS candidate", [uri(best.file)])
  for (const table of source.tables) {
    const name = quote(table.name)
    const columns = db.query<{ name: string; pk: number }, []>(`PRAGMA main.table_xinfo(${name})`).all()
    if (table.name === "migration" && columns.map((c) => c.name).join(",") === "id,time_completed") {
      if (db.query("SELECT id FROM main.migration EXCEPT SELECT id FROM candidate.migration LIMIT 1").get())
        conflict(source, best, "missing migrations")
      continue
    }
    if (table.name === "credential" && credentialRows(columns)) {
      if (!equivalentCredentials(db, aliases, originalIDs))
        conflict(source, best, 'missing or divergent rows in "credential"')
      continue
    }
    // rowid matters for keyless tables, duplicate rows, and code that stores rowids as handles. WITHOUT ROWID
    // tables are instead identified by their non-null primary key. Refuse if all implicit rowid aliases are hidden.
    const rowid = ["rowid", "_rowid_", "oid"].find((alias) => columns.every((col) => col.name.toLowerCase() !== alias))
    const primary = columns.filter((col) => col.pk).map((col) => col.name)
    // Independently imported native sessions/messages use their declared IDs,
    // not SQLite's insertion order. Unknown rowid tables keep the strict comparison.
    const key = table.wr || (bootstrapTables.has(table.name) && primary.length) ? primary : rowid ? [rowid] : []
    if (!key.length) conflict(source, best, `cannot identify rows in ${name}`)
    const seek = key.map((key) => `b.${quote(key)} = a.${quote(key)}`)
    // A NOCASE collation or SQLite's equal treatment of integer/real values must not hide different payloads.
    const equal = columns.map(({ name }) => {
      const col = quote(name)
      return `typeof(a.${col}) = typeof(b.${col}) AND a.${col} COLLATE BINARY IS b.${col}`
    })
    if (
      db
        .query(
          `SELECT 1 FROM main.${name} a WHERE NOT EXISTS (
      SELECT 1 FROM candidate.${name} b WHERE ${[...seek, ...equal].join(" AND ")}
    ) LIMIT 1`,
        )
        .get()
    )
      conflict(source, best, `missing or divergent rows in ${name}`)
  }
}

function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function conflict(source: Store, best: Store, reason: string): never {
  throw new Error(
    `Cannot reconcile ${source.file} with ${best.file}: ${reason}. Keep both originals and resolve the conflict on separate copies before cutover.`,
  )
}
