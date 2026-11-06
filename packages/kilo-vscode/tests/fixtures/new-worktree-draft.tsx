import assert from "node:assert/strict"
import type { Readiness } from "../../webview-ui/src/types/messages"
import { newWorktreeHarness } from "./new-worktree-harness"

const scenario = process.env.DRAFT_CASE ?? "roundtrip"
const model = { providerID: "kilo", modelID: "m1" }
const image = { id: "img", filename: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,AAAA" }
const state: Record<string, unknown> = {}
if (scenario === "roundtrip") {
  state.advancedDialogImages = [image]
  state.advancedDialogSelections = { model }
}
if (scenario === "missing") {
  state.advancedDialogDraft = { project: "gone", name: "carried" }
  state.advancedDialogSelections = { model }
}
if (scenario === "explicit") {
  state.advancedDialogDraft = { project: "p2" }
  state.advancedDialogSelections = { model }
}
if (scenario === "catalog") {
  state.advancedDialogSelections = { model }
  state.advancedDialogDraft = {
    compare: true,
    versions: 3,
    allocations: [
      { providerID: "kilo", modelID: "m1", name: "Gateway Alpha", count: 2, variant: "max" },
      { providerID: "kilo", modelID: "m2", name: "Gateway Beta", count: 1, variant: "max" },
    ],
  }
}

const { window, sent, settle, checks, creates, submit, prompt, reply, close, mount, loadModels, dispose } =
  await newWorktreeHarness({
    state,
    persist: true,
    providers: scenario !== "catalog",
    projectIds: ["p1", "p2", "p3"],
    models: {
      m1: { id: "m1", name: "Gateway Alpha", variants: { max: {} } },
      m2: { id: "m2", name: "Gateway Beta", variants: { max: {} } },
    },
  })

const fill = (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector)
  assert.ok(input, `missing ${selector}`)
  input.value = value
  input.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
}
const pickProject = async (id: string) => {
  document.querySelector<HTMLButtonElement>(".am-nv-origin-project")!.click()
  await settle()
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>(".am-project-option")).find((item) =>
    item.textContent?.includes(id),
  )
  assert.ok(option, `missing project ${id}`)
  option.click()
  await settle()
}
const pickVersions = async (count: number) => {
  const pill = Array.from(document.querySelectorAll<HTMLButtonElement>(".am-nv-pill")).find(
    (item) => item.textContent?.trim() === String(count),
  )
  assert.ok(pill, `missing ${count} pill`)
  pill.click()
  await settle()
}
const compare = () => {
  const section = document.querySelector<HTMLElement>(".am-nv-compare-section")
  assert.ok(section, "missing compare section")
  return section
}
const openCompare = async () => {
  compare().querySelector<HTMLButtonElement>(".am-selector-trigger")!.click()
  await settle()
}
const allocation = (name: string) => {
  const row = Array.from(document.querySelectorAll<HTMLElement>(".am-mm-item")).find((item) =>
    item.textContent?.includes(name),
  )
  assert.ok(row, `missing allocation ${name}`)
  return row
}
const allocate = async (name: string, count?: number) => {
  const row = allocation(name)
  const box = row.querySelector<HTMLInputElement>(".am-mm-checkbox")
  assert.ok(box, `missing checkbox ${name}`)
  box.checked = true
  box.dispatchEvent(new window.Event("change", { bubbles: true }) as never)
  await settle()
  if (count == null) return
  const select = allocation(name).querySelector<HTMLSelectElement>(
    "select.am-mm-count-select:not(.am-mm-variant-select)",
  )
  assert.ok(select, `missing count ${name}`)
  select.value = String(count)
  select.dispatchEvent(new window.Event("change", { bubbles: true }) as never)
  await settle()
}
const restored = () => {
  const section = compare().querySelector<HTMLElement>(".am-selector-value")
  assert.ok(section?.textContent?.includes("Gateway Alpha"), "missing restored allocation name")
  assert.ok(section.textContent.includes("Gateway Beta"))
  return section
}

if (scenario === "roundtrip") {
  const id = await mount()
  await reply("p1", id, { status: "ready" })

  // Enter goal composition without dispatching; Create still re-probes first.
  fill(".am-prompt-input", "/goal")
  submit().click()
  await settle()
  const goal = checks().at(-1)!
  assert.equal(goal.verify, true)
  await reply("p1", goal.requestID, { status: "ready" })
  await settle()
  assert.equal(creates().length, 0)
  assert.ok(document.querySelector(".prompt-goal-header"), "goal mode must be on")
  fill(".am-prompt-input", "ship the release")

  await pickProject("p2")
  fill(".am-nv-name-input", "draft name")
  fill(".am-nv-branch-input", "feat/draft")
  await pickVersions(3)
  document.querySelector<HTMLButtonElement>(".am-nv-pill-compare")!.click()
  await settle()
  await openCompare()
  await allocate("Gateway Alpha", 2)
  await allocate("Gateway Beta", 1)
  await openCompare()
  assert.deepEqual(state.advancedDialogDraft, {
    project: "p2",
    name: "draft name",
    branch: "feat/draft",
    versions: 3,
    compare: true,
    allocations: [
      { providerID: "kilo", modelID: "m1", name: "Gateway Alpha", count: 2 },
      { providerID: "kilo", modelID: "m2", name: "Gateway Beta", count: 1 },
    ],
    goal: true,
  })
  await close()

  const next = await mount({ expected: "p2" })
  await reply("p2", next, { status: "ready" })
  assert.equal(document.querySelector<HTMLElement>(".am-nv-origin-project")?.textContent?.trim(), "p2")
  assert.equal(document.querySelector<HTMLInputElement>(".am-nv-name-input")?.value, "draft name")
  assert.equal(document.querySelector<HTMLInputElement>(".am-nv-branch-input")?.value, "feat/draft")
  assert.ok(document.querySelector(".prompt-goal-header"), "goal mode must be restored")
  assert.equal(prompt().value, "ship the release")
  assert.equal(document.querySelectorAll(".image-attachment").length, 1, "image must be restored")
  restored()
  await openCompare()
  const checked = Array.from(document.querySelectorAll<HTMLElement>(".am-mm-item-checked")).map(
    (row) => row.querySelector(".am-mm-item-name")?.textContent,
  )
  assert.deepEqual(checked, ["Gateway Alpha", "Gateway Beta"])
  assert.deepEqual((state.advancedDialogDraft as { allocations?: unknown }).allocations, [
    { providerID: "kilo", modelID: "m1", name: "Gateway Alpha", count: 2 },
    { providerID: "kilo", modelID: "m2", name: "Gateway Beta", count: 1 },
  ])
  await openCompare()
  // Versions are hidden while comparing; leaving compare shows the restored count.
  document.querySelector<HTMLButtonElement>(".am-nv-pill-back")!.click()
  await settle()
  assert.equal(document.querySelector(".am-nv-pill-active")?.textContent?.trim(), "3")
  await close()
}

if (scenario === "missing") {
  const id = await mount()
  assert.equal(checks().at(0)?.projectId, "p1", "a missing saved project must not be checked")
  assert.equal(document.querySelector<HTMLElement>(".am-nv-origin-project")?.textContent?.trim(), "p1")
  assert.equal(document.querySelector<HTMLInputElement>(".am-nv-name-input")?.value, "carried")
  await close()

  // An untouched draft follows the active project instead of pinning the old one.
  const next = await mount({ projectId: "p2", activeProjectId: "p2" })
  assert.equal(checks().at(0)?.projectId, "p2")
  assert.equal(document.querySelector<HTMLElement>(".am-nv-origin-project")?.textContent?.trim(), "p2")
  await reply("p2", next, { status: "ready" })

  fill(".am-nv-branch-input", "feat/submitted")
  fill(".am-prompt-input", "do not resurrect me")
  await pickVersions(2)
  submit().click()
  await settle()
  const verify = checks().at(-1)!
  assert.equal(verify.verify, true)
  await reply("p2", verify.requestID, { status: "ready" })
  await settle()
  assert.equal(creates().length, 1)
  assert.equal(state.advancedDialogDraft, undefined, "a dispatch must clear the persisted draft")

  // A late edit during the close transition must not write the draft back.
  const late = document.querySelector<HTMLInputElement>(".am-nv-name-input")
  assert.ok(late, "dialog content must remain mounted during the exit transition")
  late.value = "resurrected"
  late.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
  await settle()
  assert.equal(state.advancedDialogDraft, undefined, "a submitted draft must not be resurrected")
  await close()

  await mount({ projectId: "p2", activeProjectId: "p2" })
  assert.equal(document.querySelector<HTMLElement>(".am-nv-origin-project")?.textContent?.trim(), "p2")
  assert.equal(document.querySelector<HTMLInputElement>(".am-nv-name-input")?.value, "")
  assert.equal(document.querySelector<HTMLInputElement>(".am-nv-branch-input")?.value, "")
  assert.equal(prompt().value, "")
  assert.equal(document.querySelector(".am-nv-pill-active")?.textContent?.trim(), "1")
  assert.equal(document.querySelector(".am-nv-compare-section"), null)
  assert.equal(document.querySelector(".prompt-goal-header"), null)
  assert.equal(document.querySelectorAll(".image-attachment").length, 0)
  await close()
}

if (scenario === "explicit") {
  // A "+" click on a non-active project row must beat the saved draft project.
  const id = await mount({ projectId: "p3", activeProjectId: "p1" })
  assert.equal(checks().at(0)?.projectId, "p3")
  assert.equal(document.querySelector<HTMLElement>(".am-nv-origin-project")?.textContent?.trim(), "p3")
  await reply("p3", id, { status: "ready" })
  await close()
}

if (scenario === "catalog") {
  const id = await mount()
  assert.equal(checks().at(0)?.projectId, "p1")
  // The catalog has not arrived yet: the restored compare allocation still shows its saved names.
  restored()
  assert.equal(submit().disabled, true, "creation waits for the catalog")
  await reply("p1", id, { status: "ready" })

  await loadModels()
  restored()
  assert.equal(submit().disabled, false)
  await openCompare()
  const checked = Array.from(document.querySelectorAll<HTMLElement>(".am-mm-item-checked")).map(
    (row) => row.querySelector(".am-mm-item-name")?.textContent,
  )
  assert.deepEqual(checked, ["Gateway Alpha", "Gateway Beta"])
  assert.deepEqual((state.advancedDialogDraft as { allocations?: unknown }).allocations, [
    { providerID: "kilo", modelID: "m1", name: "Gateway Alpha", count: 2, variant: "max" },
    { providerID: "kilo", modelID: "m2", name: "Gateway Beta", count: 1, variant: "max" },
  ])
  await openCompare()

  // The saved single-model choice also survives the empty catalog.
  document.querySelector<HTMLButtonElement>(".am-nv-pill-back")!.click()
  await settle()
  assert.ok(
    document.querySelector(".prompt-input-hint .model-selector-trigger-label")?.textContent?.includes("Gateway Alpha"),
  )
  await close()
}

dispose()
await window.happyDOM.abort()
window.close()
