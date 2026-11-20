import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { inputs, receipt } from "./receipt"
import { currentPreviewStores, explicitConfig, preflight } from "./preflight"
import { previewRevisions } from "./preview"
import {
  observeOwner,
  readOwner,
  retryOwner,
  stageJournal,
  withOwner,
  type MigrationProgress,
  type OwnerState,
} from "./owner"
import { recordedStage } from "./stage-record"
import { releaseProfile } from "../env"
import { assertProjectConfig, projectLocations } from "./project-config"

type Plan = ReturnType<typeof preflight>
type Report = (progress: MigrationProgress) => void

export function migrationStatus(plan: Plan) {
  if (plan.status === "required") explicitConfig(plan)
  const owner = plan.status === "required" ? readOwner(plan.source) : undefined
  // The marker was checkpointed before publication. An immutable probe checks the canonical file
  // without creating SHM or adopting a restored store on the strength of an old owner journal.
  if (owner?.status === "completed") ready(plan)
  return { ...plan, ...owner, canObserve: owner?.status === "running" }
}

export async function applyCutover(plan: Plan, report: Report) {
  if (plan.status !== "required") throw new Error(`No session database at ${plan.source}`)
  explicitConfig(plan)
  // Catch conflicts on a closed source without even creating the pilot owner journal.
  // A WAL-backed source gets its authoritative inspection on the consistent private stage below.
  if (!readOwner(plan.source) && !existsSync(`${plan.source}-wal`) && !existsSync(`${plan.source}-journal`))
    assertProjectConfig(projectLocations(plan.source), plan.home)
  await withOwner(plan.source, (update) => convert(plan, update), verified(plan, report))
  ready(plan)
}

function ready(plan: Plan) {
  receipt(plan)
  assertProjectConfig([process.cwd()], plan.home)
}

function verified(plan: Plan, report: Report) {
  return (state: OwnerState) => {
    if (state.status === "completed") ready(plan)
    report(state)
  }
}

export async function observeCutover(plan: Plan, report: Report) {
  await observeOwner(plan.source, verified(plan, report))
  ready(plan)
}

/** Recovery is a separate consent, never an implicit response to a stale lock. */
export async function recoverCutover(plan: Plan, report: Report) {
  explicitConfig(plan)
  const { requireV1Store } = await import("../v1-store")
  const { linkedOriginal, retryPublication } = await import("./publish")
  if (existsSync(plan.backup) && !linkedOriginal(plan.source, plan.backup)) {
    const { verifyPublished } = await import("./verify-published")
    const { finishRecovered } = await import("./owner")
    return finishRecovered(
      plan.source,
      async () => {
        verifyPublished(plan.source, plan.backup)
        await finishResources(plan)
        recordedStage(stageJournal(plan.source), plan.backup)?.remove()
      },
      report,
    )
  }
  return retryOwner(
    plan.source,
    () => {
      requireV1Store(plan.source)
      retryPublication(plan.source, plan.backup, stageJournal(plan.source))
    },
    (update) => convert(plan, update),
    report,
  )
}

async function convert(plan: Plan, update: Report) {
  process.env.OPENCODE_APP_DIR_NAME = "kilo"
  process.env.KILO_USE_RELEASE_CONFIG = "1"
  const { resources } = await import("./resources")
  const intent = resources(plan)
  if (existsSync(plan.backup))
    throw new Error(`A recovery copy already exists: ${plan.backup}. Inspect it before retrying.`)
  const previews = previewRevisions(plan.previewStores)
  const checkPreviews = () => {
    if (JSON.stringify(previewRevisions(currentPreviewStores(plan))) !== JSON.stringify(previews))
      throw new Error("A preview store changed during migration. Close all preview clients and retry.")
  }
  const { planAuth } = await import("./auth")
  const auth = planAuth(plan.authFiles)
  const { stageAndPublish } = await import("./publish")
  await stageAndPublish(
    plan.source,
    plan.backup,
    async (stage) => {
      const projects = projectLocations(stage)
      const originalIDs = plan.previewStores.length ? credentialIDs(stage) : undefined
      assertProjectConfig(projects, plan.home)
      await import("../preload")
      const { convertProfile } = await import("../v1-store")
      const { reconcilePreview } = await import("./preview")
      update({ phase: "Converting sessions" })
      await convertProfile(stage, {
        data: plan.legacyData,
        authFiles: auth.sources,
        progress: (done, total) => update({ phase: "Converting sessions", done, total }),
      })
      update({ phase: "Checking preview profiles" })
      reconcilePreview(stage, plan.previewStores, originalIDs)
      // Use each original profile's known locations; project rows synthesized by the
      // converter are not evidence that the user had local preview resources there.
      for (const file of plan.previewStores) for (const location of projectLocations(file)) projects.add(location)
      assertProjectConfig(projects, plan.home)
      update({ phase: "Verifying converted sessions" })
      using db = new Database(stage, { readwrite: true })
      auth.verify(db)
      if (db.query("SELECT id FROM session EXCEPT SELECT id FROM session_v2 LIMIT 1").get())
        throw new Error("Session verification failed; the source profile was not switched.")
      checkPreviews()
      if (resources(plan).digest !== intent.digest) throw new Error("Profile resources changed during staging")
      db.run(
        "CREATE TABLE _kilo_profile_cutover (version INTEGER PRIMARY KEY, original_file TEXT NOT NULL, inputs TEXT NOT NULL, resources TEXT NOT NULL)",
      )
      const original = statSync(plan.source, { bigint: true })
      db.run("INSERT INTO _kilo_profile_cutover VALUES (3, ?, ?, ?)", [
        `${original.dev}:${original.ino}`,
        JSON.stringify({ ...inputs(plan), previews }),
        intent.digest,
      ])
      db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    },
    (phase) => update({ phase }),
    { checkInputs: checkPreviews, journal: stageJournal(plan.source) },
  )
  update({ phase: "Reconciling configuration" })
  await finishResources(plan)
  recordedStage(stageJournal(plan.source), plan.backup)?.remove()
  for (const item of intent.skipped) update({ phase: `Skipped: ${item}` })
  update({ phase: "Profile ready" })
}

function credentialIDs(stage: string) {
  using db = new Database(stage, { readonly: true })
  return new Set(
    db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='credential'").get()
      ? db
          .query<{ id: string }, []>("SELECT id FROM credential")
          .all()
          .map((row) => row.id)
      : [],
  )
}

async function finishResources(plan: Plan) {
  const expected = receipt(plan)
  const { resources } = await import("./resources")
  const files = resources(plan)
  if (files.digest !== expected)
    throw new Error("Profile resources differ from the accepted plan. Restore the planned inputs before recovery.")
  files.apply()
}

export async function beforeBoot() {
  const plan = preflight(process.env)
  if (plan.status === "absent") return true
  const current = migrationStatus(plan)
  if (current.status === "failed" || current.status === "interrupted")
    throw new Error(
      `Migration ${current.status}: ${"message" in current ? current.message : "inspect recovery state"}. Recovery path: ${plan.backup}`,
    )
  if (current.status === "running") {
    await observeCutover(plan, (state) => console.error(state.phase))
  } else if (current.status !== "completed") {
    const { terminalCutover } = await import("./terminal")
    if (!(await terminalCutover(plan, (notify) => applyCutover(plan, notify)))) return false
    // Conversion loaded Global/config in this process. Restart this invocation so every layer
    // selects the verified release profile; it goes through ordinary preflight again.
    const { bin } = await import("../browser/bin")
    if (!process.execve) throw new Error("Migration completed. Relaunch Kilo to use the migrated profile.")
    process.execve(process.execPath, [...bin(), ...process.argv.slice(2)], process.env)
  }
  // A restored or replaced database must not inherit an old successful run's permission to start.
  const { openReadonly } = await import("../sqlite-readonly")
  using db = openReadonly(plan.source).db
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_kilo_profile_cutover'").get())
    throw new Error("Migrated database marker is missing. Inspect the recovery copy before starting Kilo.")
  receipt(plan)
  // Child launchers need the same preview selectors after releaseProfile sets runtime paths.
  process.env.KILO2_CONFIG_DIR = plan.previewConfig
  if (plan.previewDatabase) process.env.KILO2_DB = plan.previewDatabase
  process.env.XDG_STATE_HOME = path.dirname(plan.legacyState)
  if (plan.implicitState) process.env.KILO_INTERNAL_CUTOVER_IMPLICIT_STATE = process.env.XDG_STATE_HOME
  releaseProfile(plan.source, plan.legacyConfig, explicitConfig(plan))
  return true
}
