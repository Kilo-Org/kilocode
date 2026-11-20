import type { Database } from "bun:sqlite"
import fs from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { parseTree, getNodeValue, type Node, type ParseError } from "jsonc-parser"
import { z } from "zod"

const auth = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("api"), key: z.string(), metadata: z.record(z.string(), z.string()).optional() }),
  z.strictObject({
    type: z.literal("oauth"),
    access: z.string(),
    refresh: z.string(),
    expires: z.number().int().nonnegative(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("wellknown"), key: z.string(), token: z.string() }),
])
type Entry = z.infer<typeof auth>

/** Never put provider names, credential values, parse errors, or file contents in client progress or the owner journal. */
export function planAuth(files: string[]) {
  const records = inventory(files)
  function verify(db: Database) {
    if (!isDeepStrictEqual(records, inventory(files)))
      throw new Error(`Sign-in files changed during migration. Review ${files.join(" and ")}.`)
    for (const [id, { entry, file }] of records) {
      // Match the active credential; merely finding the provider ID does not prove its sign-in survived.
      const row = db
        .query<
          { value: string },
          [string]
        >("SELECT value FROM credential WHERE integration_id=? ORDER BY active DESC, time_created DESC, id DESC LIMIT 1")
        .get(id)
      if (!row || !matches(entry, row.value))
        throw new Error(
          `Stored sign-in differs from ${file}. Reconcile the session store and sign-in file before switching.`,
        )
      if (
        entry.type === "wellknown" &&
        !db.query("SELECT 1 FROM kv, json_each(kv.value) j WHERE kv.key='wellknown:sources' AND j.value=?").get(id)
      )
        throw new Error(`Missing sign-in origin from ${file}.`)
    }
  }
  return { verify, sources: [...new Set([...records.values()].map((record) => record.file))] }
}

function inventory(files: string[]) {
  const records = new Map<string, { entry: Entry; file: string }>()
  for (const file of files) {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false })
    if (!stat) continue
    if (!stat.isFile()) throw new Error(`Expected a regular sign-in file: ${file}`)
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
    )
    try {
      const opened = fs.fstatSync(fd)
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev)
        throw new Error(`Sign-in file changed: ${file}`)
      const errors: ParseError[] = []
      const doc = parseTree(fs.readFileSync(fd, "utf8"), errors, { disallowComments: true })
      if (errors.length || doc?.type !== "object" || duplicateKeys(doc))
        throw new Error(`Invalid or ambiguous sign-in file: ${file}`)
      for (const item of doc.children ?? []) {
        const id = String(item.children![0]!.value).replace(/\/+$/, "")
        const parsed = auth.safeParse(getNodeValue(item.children![1]!))
        if (!id || !parsed.success)
          throw new Error(`Unsupported sign-in entry in ${file}; reconcile it before switching.`)
        const prior = records.get(id)
        if (prior && !isDeepStrictEqual(prior.entry, parsed.data))
          throw new Error(`Conflicting sign-ins: ${prior.file} and ${file}. Reconcile the files before switching.`)
        if (!prior) records.set(id, { entry: parsed.data, file })
      }
    } finally {
      fs.closeSync(fd)
    }
  }
  return records
}

function duplicateKeys(node: Node): boolean {
  const children = node.children ?? []
  if (
    node.type === "object" &&
    new Set(children.map((property) => property.children![0]!.value)).size !== children.length
  )
    return true
  return children.some(duplicateKeys)
}

function matches(entry: Entry, value: string) {
  try {
    const stored = JSON.parse(value)
    if (entry.type === "api")
      return stored.type === "key" && stored.key === entry.key && isDeepStrictEqual(stored.metadata, entry.metadata)
    if (entry.type === "wellknown") return stored.type === "key" && stored.key === entry.token
    return (
      stored.type === "oauth" &&
      stored.access === entry.access &&
      stored.refresh === entry.refresh &&
      stored.expires === entry.expires &&
      stored.metadata?.accountID === entry.accountId &&
      stored.metadata?.enterpriseUrl === entry.enterpriseUrl
    )
  } catch {
    return false
  }
}
