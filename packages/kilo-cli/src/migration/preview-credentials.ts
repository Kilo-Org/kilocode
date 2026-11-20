import type { Database } from "bun:sqlite"
import { isDeepStrictEqual } from "node:util"

type Row = {
  id: string
  integration_id: string | null
  label: string
  value: string
  connector_id: string | null
  method_id: string | null
  active: number | null
  time_created: number
  time_updated: number
}
export type CredentialAliases = Map<string, { target: string; row: Row }>

// Never relax containment on an unknown/plugin credential schema.
export function credentialRows(columns: { name: string }[]) {
  return (
    columns
      .map((c) => c.name)
      .sort()
      .join(",") === "active,connector_id,id,integration_id,label,method_id,time_created,time_updated,value"
  )
}

function credentials(db: Database, schema: "main" | "candidate") {
  return db.query<Row, []>(`SELECT * FROM ${schema}.credential ORDER BY active DESC,time_created DESC,id DESC`).all()
}

function same(a: Row, b: Row) {
  if (
    a.integration_id !== b.integration_id ||
    a.label !== b.label ||
    a.connector_id !== b.connector_id ||
    a.method_id !== b.method_id
  )
    return false
  if (a.value === b.value) return true
  try {
    return isDeepStrictEqual(JSON.parse(a.value), JSON.parse(b.value))
  } catch {
    return false
  }
}

/** Keep durable credential IDs. Only a singleton with the same provider, secret, and
 * metadata can have an independently generated equivalent. Never guess between accounts. */
export function equivalentCredentials(db: Database, aliases: CredentialAliases, originalIDs?: ReadonlySet<string>) {
  const source = credentials(db, "main")
  const best = credentials(db, "candidate")
  const byID = new Map(best.map((row) => [row.id, row]))
  const sourceGroups = Map.groupBy(source, (row) => row.integration_id)
  const bestGroups = Map.groupBy(best, (row) => row.integration_id)
  for (const row of source) {
    const left = sourceGroups.get(row.integration_id)!
    const right = bestGroups.get(row.integration_id) ?? []
    const exact = byID.get(row.id)
    if (exact) {
      if (!same(row, exact) || (left[0] === row && right[0]?.id !== row.id)) return false
      continue
    }
    const match = right[0]
    if (!row.integration_id || left.length !== 1 || right.length !== 1 || !match || !same(row, match)) return false
    // IDs newly minted on the private candidate have never been visible to another client.
    if (originalIDs && !originalIDs.has(row.id)) continue
    const prior = aliases.get(row.id)
    if (prior && prior.target !== match.id) return false
    aliases.set(row.id, { target: match.id, row })
  }
  return true
}

export function installCredentials(db: Database, aliases: CredentialAliases, originalIDs?: ReadonlySet<string>) {
  db.exec("PRAGMA foreign_keys=ON")
  db.transaction(() => {
    const replaced = new Map<string, string>()
    for (const { target, row } of aliases.values()) {
      if (originalIDs && !originalIDs.has(target) && !replaced.has(target)) {
        db.run("UPDATE credential SET id=? WHERE id=?", [row.id, target])
        replaced.set(target, row.id)
        continue
      }
      // Both IDs were externally visible. Preserve references to either and leave the
      // chosen store's equivalent credential selected, regardless of creation order.
      db.run("UPDATE credential SET active=1 WHERE id=?", [replaced.get(target) ?? target])
      db.run(
        "INSERT INTO credential(id,integration_id,label,value,connector_id,method_id,active,time_created,time_updated) VALUES (?,?,?,?,?,?,0,?,?)",
        [
          row.id,
          row.integration_id,
          row.label,
          row.value,
          row.connector_id,
          row.method_id,
          row.time_created,
          row.time_updated,
        ],
      )
    }
  })()
}
