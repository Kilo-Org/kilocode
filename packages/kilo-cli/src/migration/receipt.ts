import { constants, Database } from "bun:sqlite"
import { pathToFileURL } from "node:url"
import { currentPreviewStores, explicitConfig, type preflight } from "./preflight"
import { previewRevisions } from "./preview"
import { lstatSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

type Plan = ReturnType<typeof preflight>

// Only path selectors, never credentials or config contents. A different launcher may
// share the canonical database without having participated in the same reconciliation.
export function inputs(plan: Plan) {
  return {
    source: plan.source,
    home: plan.home,
    state: plan.stateBase,
    v1State: plan.v1State,
    previewState: plan.previewState,
    releaseState: plan.legacyState,
    configBase: plan.configBase,
    legacyData: plan.legacyData,
    legacyConfig: plan.legacyConfig,
    previewConfig: plan.previewConfig,
    explicitFile: explicitConfig(plan) ?? null,
    previewDatabase: plan.previewDatabase,
  }
}

export function receipt(plan: Plan) {
  using db = new Database(
    `${pathToFileURL(plan.source).href}?immutable=1`,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
  )
  if (!db.query("SELECT 1 FROM pragma_table_info('_kilo_profile_cutover') WHERE name='inputs'").get())
    throw new Error("Missing verified migration inputs. Inspect the original recovery copy before starting Kilo.")
  const row = db
    .query<
      { version: number; inputs: string; resources: string },
      []
    >("SELECT version,inputs,resources FROM _kilo_profile_cutover WHERE version IN (2,3)")
    .get()
  if (!row) throw new Error("Missing verified cutover marker")
  const expected = JSON.parse(row.inputs)
  if (row.version === 2) {
    // Old receipts are only evidence for the two default (non-fallback) state directories.
    expected.v1State = expected.releaseState = path.join(expected.state, "kilo")
    expected.previewState = path.join(expected.state, "kilo2")
  }
  const revisions =
    row.version === 3
      ? z.record(z.string(), z.string()).parse(expected.previews)
      : Object.fromEntries(
          z
            .array(z.string())
            .parse(expected.previewStores)
            .map((file) => [file, null]),
        )
  const current = previewRevisions(currentPreviewStores(plan))
  for (const [file, revision] of Object.entries(current)) {
    if (revisions[file] !== revision)
      throw new Error(
        `New, changed or unverified preview history at ${file}. Reconcile this store before starting Kilo.`,
      )
  }
  for (const file of Object.keys(revisions)) {
    if (!(file in current) && ["-wal", "-journal"].some((s) => lstatSync(file + s, { throwIfNoEntry: false })?.size))
      throw new Error(`Missing archived preview with outstanding SQLite sidecars: ${file}`)
  }
  for (const [key, value] of Object.entries(inputs(plan))) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(value))
      throw new Error(
        `Migration used different ${key}: ${JSON.stringify(expected[key])}. This launcher selects ${JSON.stringify(value)}. Reconcile the profiles before starting Kilo.`,
      )
  }
  return row.resources
}
