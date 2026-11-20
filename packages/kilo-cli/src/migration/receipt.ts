import { constants, Database } from "bun:sqlite"
import { pathToFileURL } from "node:url"
import { explicitConfig, type preflight } from "./preflight"

type Plan = ReturnType<typeof preflight>

// Only path selectors, never credentials or config contents. A different launcher may
// share the canonical database without having participated in the same reconciliation.
export function inputs(plan: Plan) {
  return {
    source: plan.source,
    home: plan.home,
    state: plan.stateBase,
    configBase: plan.configBase,
    legacyData: plan.legacyData,
    legacyConfig: plan.legacyConfig,
    previewConfig: plan.previewConfig,
    explicitFile: explicitConfig(plan) ?? null,
    previewDatabase: plan.previewDatabase,
    previewStores: plan.previewStores,
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
      { inputs: string; resources: string },
      []
    >("SELECT inputs,resources FROM _kilo_profile_cutover WHERE version=2")
    .get()
  if (!row) throw new Error("Missing verified cutover marker")
  const expected = JSON.parse(row.inputs)
  for (const [key, value] of Object.entries(inputs(plan))) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(value))
      throw new Error(
        `Migration used different ${key}: ${JSON.stringify(expected[key])}. This launcher selects ${JSON.stringify(value)}. Reconcile the profiles before starting Kilo.`,
      )
  }
  return row.resources
}
