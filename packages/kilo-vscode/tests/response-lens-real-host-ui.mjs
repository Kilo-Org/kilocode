import assert from "node:assert/strict"
import path from "node:path"
import { writeFile } from "node:fs/promises"
import { measureBadge, settledPopover } from "./response-lens-real-host-geometry.mjs"
import { foreground } from "./response-lens-real-host-focus.mjs"

export async function webview(page, selector, timeout = 60000) {
  const pending = Promise.withResolvers()
  const seen = new WeakSet()
  const scan = (frame) => {
    if (seen.has(frame)) return
    seen.add(frame)
    frame
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout })
      .then(
        () => pending.resolve(frame),
        () => {},
      )
  }
  page.on("frameattached", scan)
  page.on("framenavigated", scan)
  page.frames().forEach(scan)
  const timer = setTimeout(() => pending.reject(new Error(`Real webview not ready: ${selector}`)), timeout)
  try {
    return await pending.promise
  } finally {
    clearTimeout(timer)
    page.off("frameattached", scan)
    page.off("framenavigated", scan)
  }
}

export async function startup(page, server, expect, run, name, manager = false) {
  const host = await server.command({ activate: "kilocode.kilo-code" })
  assert.ok(host.extensions.find((ext) => ext.id === "kilocode.kilo-code")?.active)
  await server.command({ command: manager ? "kilo-code.new.agentManagerOpen" : "kilo-code.SidebarProvider.focus" })
  const frame = await webview(page, manager ? ".am-layout" : ".model-selector-trigger-label")
  if (manager) {
    const local = frame.locator('[data-sidebar-id="local"]')
    await expect(local).toBeVisible()
    await local.click()
    await expect(local).toHaveClass(/am-local-item-active/)
    if (name === "cold") await frame.locator('.am-tab-add-split [data-component="icon-button"]').click()
  }
  const label = frame.locator(".model-selector-trigger-label:visible").first()
  await expect(label).toContainText("Fixture Model", { timeout: 60000 })
  await label.click()
  const picker = frame.locator(".model-selector-popover")
  await expect(picker).toBeVisible()
  await expect(picker).toContainText("Fixture Model")
  await expect(picker).toContainText("Real Host Fixture")
  await page.screenshot({ path: path.join(run.root, `${name}-provider-picker.png`) })
  const choice = picker.getByRole("treeitem", { name: "Fixture Model Real Host Fixture", exact: true })
  if ((await picker.getAttribute("class")).includes("--expanded")) await choice.dblclick()
  else await choice.click()
  await expect(picker).not.toBeVisible()
  await expect(frame.locator("textarea.prompt-input:visible")).toBeEnabled()
  return frame
}

export async function send(frame, page, expect, index) {
  const turn = String(index).padStart(4, "0")
  const input = frame.locator("textarea.prompt-input:visible")
  const start = performance.now()
  await input.fill(`RL_TURN_${turn}: Return the deterministic fixture answer. Do not use tools.`)
  await input.press("Enter")
  const row = frame
    .locator('[data-row="assistant"]')
    .filter({ hasText: `RL_REPLY_${turn}.` })
    .last()
  await expect(row).toContainText(`RL_END_${turn}.`, { timeout: 60000 })
  await expect(frame.getByRole("button", { name: /^Stop/ })).not.toBeVisible({ timeout: 60000 })
  await expect(input).toHaveValue("")
  const latency = performance.now() - start
  return { row, latency }
}

export async function select(row, page, frame, expect, run, stage) {
  const paragraph = row.locator("p").last()
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.click({ trial: true })
  // Pointer selection, not a synthetic selection event or application state write.
  const box = await paragraph.boundingBox()
  assert.ok(box && box.width > 20 && box.height > 0)
  const before = await paragraph.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = (x) => {
      const target = document.elementFromPoint(x, rect.y + Math.min(8, rect.height / 2))
      return { withinParagraph: element.contains(target), tag: target?.tagName, class: target?.className }
    }
    return {
      rect: rect.toJSON(),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      start: hit(rect.x + 1),
      end: hit(rect.x + Math.min(rect.width - 2, 240)),
    }
  })
  await writeFile(path.join(run.root, `selection-${stage}.json`), JSON.stringify({ box, before }, null, 2))
  assert.ok(
    before.start.withinParagraph && before.end.withinParagraph,
    `Pointer selection endpoints are obstructed: ${JSON.stringify(before)}`,
  )
  await page.mouse.move(box.x + 1, box.y + Math.min(8, box.height / 2))
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(box.width - 2, 240), box.y + Math.min(8, box.height / 2), { steps: 12 })
  await page.mouse.up()
  const selection = await row.evaluate((element) => {
    const current = window.getSelection()
    return {
      text: current?.toString(),
      collapsed: current?.isCollapsed,
      withinRow: current?.rangeCount > 0 && element.contains(current.getRangeAt(0).commonAncestorContainer),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
    }
  })
  await writeFile(path.join(run.root, `selection-${stage}.json`), JSON.stringify({ box, before, selection }, null, 2))
  assert.ok(
    selection.text?.trim() && !selection.collapsed && selection.withinRow,
    `Actual pointer drag did not select completed assistant text: ${JSON.stringify(selection)}`,
  )
  await expect(frame.locator(".selection-toolbar")).toBeVisible()
  const toolbar = frame.locator(".selection-toolbar")
  for (const name of ["Copy", "Annotate", "Explain Briefly"])
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible()
}

export async function lens(frame, page, row, expect, server, run) {
  await select(row, page, frame, expect, run, "initial")
  await page.screenshot({ path: path.join(run.root, "selection-controls.png") })
  await frame.locator(".selection-toolbar").getByRole("button", { name: "Annotate", exact: true }).click()
  const editor = frame.locator('[data-component="annotation-popover"]')
  await expect(editor).toBeVisible()
  await editor.getByRole("textbox", { name: "Annotation comment" }).fill("Real packaged host note one")
  await settledPopover(editor, expect, page, run, "annotation-popover-settled")
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(frame.getByRole("button", { name: "Annotation #1", exact: true })).toBeVisible({ timeout: 15000 })
  await measureBadge(frame, expect, page, run)
  const toggle = frame.locator(".prompt-annotations-toggle")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await select(row, page, frame, expect, run, "new-note")
  await frame.locator(".selection-toolbar").getByRole("button", { name: "Annotate", exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(frame.locator(".prompt-annotations-list")).not.toBeVisible()
  await settledPopover(editor, expect, page, run, "new-note-collapsed")
  await editor.getByRole("button", { name: "Cancel", exact: true }).click()
  await select(row, page, frame, expect, run, "explain")
  const before = server.calls.length
  await frame.locator(".selection-toolbar").getByRole("button", { name: "Explain Briefly", exact: true }).click()
  const popup = frame.locator('[data-component="response-lens"]')
  await expect(popup.locator(".response-lens-result")).toContainText("RL_EXPLANATION", { timeout: 60000 })
  assert.ok(server.calls.length > before, "Explanation did not reach synthetic provider")
  assert.ok(server.calls.slice(before).every((call) => call.model === "fixture-model"))
  await popup.locator('[data-slot="select-select-trigger"][aria-label="Explanation level"]').click()
  await frame.getByRole("option", { name: "University", exact: true }).click()
  await expect(popup).toContainText("University")
  await popup.getByRole("button", { name: "Retry explanation", exact: true }).click()
  await expect(popup.locator(".response-lens-result")).toContainText("RL_EXPLANATION", { timeout: 60000 })
  await page.screenshot({ path: path.join(run.root, "explanation-settings.png") })
  await popup.getByRole("button", { name: "Close", exact: true }).click()
  const status = await server.command()
  assert.equal(status.settings?.level, "university", "Real VS Code settings write did not persist")
}

export async function history(frame, page, expect, count, app, run, start = 2) {
  const latencies = []
  const started = performance.now()
  for (let index = start; index < count + start; index++)
    latencies.push((await send(frame, page, expect, index)).latency)
  const focus = await foreground(app, page, frame, run)
  const metrics = await frame.evaluate(async () => {
    const list = [...document.querySelectorAll(".message-list")].find((node) => node.getClientRects().length)
    if (!list) throw new Error("Real transcript missing")
    const initial = { visibility: document.visibilityState, focused: document.hasFocus() }
    let lostForeground = false
    const check = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) lostForeground = true
    }
    document.addEventListener("visibilitychange", check)
    window.addEventListener("blur", check, true)
    const before = performance.now()
    try {
      list.scrollTop = 0
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      list.scrollTop = list.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        scrollMs: performance.now() - before,
        nodes: document.querySelectorAll("*").length,
        height: list.scrollHeight,
        initial,
        lostForeground,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      }
    } finally {
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("blur", check, true)
    }
  })
  await writeFile(
    path.join(run.root, "history-performance.json"),
    JSON.stringify({ focus, metrics, latencies }, null, 2),
  )
  assert.ok(
    !metrics.lostForeground && metrics.initial.focused && metrics.focused && metrics.visibility === "visible",
    `Repaint measurement lost foreground; not a valid rendering-latency sample: ${JSON.stringify(metrics)}`,
  )
  assert.ok(metrics.scrollMs < 5000, `Transcript repaint stalled over five seconds: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.height > 1000, "Long-history case did not produce a scrollable transcript")
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    turns: count,
    elapsedMs: performance.now() - started,
    latencies,
    p50Ms: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    focus,
    ...metrics,
  }
}

export async function codex(page, server, expect, run) {
  const host = await server.command({ activate: "openai.chatgpt" })
  assert.ok(host.extensions.find((ext) => ext.id === "openai.chatgpt")?.active)
  await server.command({ command: "chatgpt.openSidebar" })
  const frame = await webview(page, 'button:has-text("Sign in")', 45000)
  await expect(frame.getByRole("button", { name: /Sign in/i }).first()).toBeVisible()
  await page.screenshot({ path: path.join(run.root, "codex-onboarding.png") })
  return { status: "passed", scope: "packaged renderer onboarding only; no login, accounts, or conversation requests" }
}
