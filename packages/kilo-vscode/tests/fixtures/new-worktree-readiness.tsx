import assert from "node:assert/strict"
import type { Readiness } from "../../webview-ui/src/types/messages"
import { post } from "../../webview-ui/src/utils/webview-message"
import { newWorktreeHarness } from "./new-worktree-harness"

const {
  window,
  saved,
  sent,
  features,
  setFeatures,
  settle,
  emit,
  checks,
  creates,
  submit,
  prompt,
  readiness,
  card,
  reply,
  shortcut,
  close,
  mount,
  closes,
  dispose,
} = await newWorktreeHarness()

const plain: Readiness = { status: "blocked", code: "not_git_repo", name: "scratch", trusted: true, identity: true }

if (process.env.READINESS_CASE !== "install") {
  // Deliver the reply in the same turn as close, while the real dialog is still mounted.
  for (const method of ["escape", "button"]) {
    if (process.env.READINESS_CASE && process.env.READINESS_CASE !== method) continue
    const id = await mount()
    submit().click()
    if (method === "escape") {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never)
    } else {
      document.querySelector<HTMLButtonElement>(".am-nv-close")!.click()
    }
    assert.ok(document.querySelector(".am-nv-submit"), "reply must arrive before exit cleanup")
    post({
      type: "agentManager.readiness",
      projectId: "p1",
      requestID: checks().at(-1)!.requestID,
      result: { status: "ready" },
    })
    // Drain the request's chained continuations, not the 100 ms exit timer.
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    assert.equal(creates().length, 0, `${method}: close-start must cancel submit`)
    assert.ok(document.querySelector(".am-nv-submit"), "assert before exit cleanup")
    await close()
  }

  if (!process.env.READINESS_CASE || process.env.READINESS_CASE === "projects") {
    const id = await mount()
    submit().click()
    for (const target of ["p2", "p1"]) {
      document.querySelector<HTMLButtonElement>(".am-nv-origin-project")!.click()
      await settle()
      const option = Array.from(document.querySelectorAll<HTMLButtonElement>(".am-project-option")).find((item) =>
        item.textContent?.includes(target),
      )
      assert.ok(option, `missing project ${target}`)
      option.click()
      await settle()
    }
    const gate = checks().at(1)!
    assert.equal(gate.verify, true)
    await reply("p1", gate.requestID, { status: "ready" })
    assert.equal(creates().length, 0, "returning to A must not resume A's original submit")
    assert.equal(checks().length, 4, "returning to A must send a new request")
    await settle()
    submit().click()
    await reply("p1", id, { status: "ready" })
    assert.equal(creates().length, 0, "old A reply must not unlock the newer gate")
    const current = checks().at(-1)!
    assert.equal(current.verify, true)
    assert.notEqual(current.requestID, gate.requestID)
    await reply("p1", current.requestID, { status: "ready" })
    await settle()
    assert.equal(creates().length, 1)
    await close()
  }

  // A switch fix keeps the selected project's result: switching must not wipe the card.
  if (!process.env.READINESS_CASE || process.env.READINESS_CASE === "switch") {
    for (const target of ["blocked", "ready"] as const) {
      const id = await mount()
      await reply("p1", id, {
        status: "blocked",
        code: "not_git_repo",
        name: "parent",
        trusted: true,
        projects: [{ root: "/p2", label: "p2" }],
      })
      card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
      await settle()
      const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
      assert.ok(fix && fix.type === "agentManager.fixReadiness")
      if (target === "ready") card()?.querySelector<HTMLElement>("[data-readiness-title]")?.focus()
      await emit({
        type: "agentManager.readiness",
        projectId: "p1",
        requestID: fix.requestID,
        selected: "p2",
        result: target === "ready" ? { status: "ready" } : plain,
      })
      assert.equal(creates().length, 0)
      if (target === "blocked") {
        assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.plain.title")
        assert.equal(submit().getAttribute("aria-disabled"), "true")
      } else {
        assert.equal(card()?.textContent, "")
        assert.equal(submit().getAttribute("aria-disabled"), null)
        assert.equal(document.activeElement, submit())
      }
      await close()
    }
  }

  // A blocked reply keeps the dialog open with every field, and Create is aria-disabled rather than disabled.
  {
    const id = await mount()
    const area = prompt()
    area.value = "build the thing"
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
    const pill = Array.from(document.querySelectorAll<HTMLButtonElement>(".am-nv-pill")).find(
      (item) => item.textContent?.trim() === "3",
    )
    assert.ok(pill)
    pill.click()
    await reply("p1", id, plain)

    assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.plain.title")
    assert.equal(submit().getAttribute("aria-disabled"), "true")
    assert.equal(submit().disabled, false)

    submit().click()
    await settle()
    assert.equal(creates().length, 0)
    assert.equal(closes.value, 0)
    assert.equal(prompt().value, "build the thing")
    assert.ok(document.querySelector(".am-nv-pill-active")?.textContent?.includes("3"))
    assert.equal(document.querySelectorAll(".image-attachment").length, 1)
    const action = card()?.querySelector<HTMLElement>("[data-readiness-action]")
    assert.equal(action?.textContent, "agentManager.readiness.plain.action")
    assert.equal(document.activeElement, action)

    // Cmd/Ctrl+Enter from the prompt also lands on the card's action and creates nothing.
    prompt().focus()
    shortcut()
    await settle()
    assert.equal(creates().length, 0)
    assert.equal(document.activeElement, action)

    // Replies for another project or an older request are ignored.
    await reply("p2", id, { status: "ready" })
    await reply("p1", "readiness-stale-check-1", { status: "ready" })
    assert.equal(submit().getAttribute("aria-disabled"), "true")
    assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.plain.title")
    assert.deepEqual(readiness(), [{ stage: "identified", code: "not_git_repo", entry: "modal" }])

    // Check again; reaching ready clears the card but never creates on its own or takes focus.
    const again = Array.from(card()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (item) => item.textContent === "agentManager.readiness.check",
    )
    assert.ok(again)
    again.click()
    await settle()
    assert.equal(checks().length, 2)
    prompt().focus()
    await reply("p1", checks().at(1)!.requestID, { status: "ready" })
    assert.equal(card()?.textContent, "")
    assert.equal(submit().getAttribute("aria-disabled"), null)
    assert.equal(creates().length, 0)
    assert.equal(document.activeElement, prompt())

    // One event per real transition, not per re-check.
    assert.deepEqual(readiness(), [
      { stage: "identified", code: "not_git_repo", entry: "modal" },
      { stage: "resolved", code: "not_git_repo", entry: "modal" },
    ])

    // A current ready result still re-probes the tools before Create.
    submit().click()
    await settle()
    assert.equal(creates().length, 0)
    const verify = checks().at(-1)!
    assert.equal(verify.verify, true)
    assert.equal(verify.fresh, false)
    await reply("p1", verify.requestID, { status: "ready" })
    assert.equal(creates().length, 1)
    assert.equal(closes.value, 1)
  }

  // Activations while the check is pending wait for it and create exactly once.
  {
    const id = await mount()
    submit().click()
    submit().click()
    shortcut()
    await settle()
    assert.equal(creates().length, 0)
    assert.equal(checks().length, 2)
    const verify = checks().at(1)!
    assert.equal(verify.verify, true)
    await reply("p2", verify.requestID, { status: "ready" })
    assert.equal(creates().length, 0)
    await reply("p1", id, { status: "ready" })
    assert.equal(creates().length, 0)
    await reply("p1", verify.requestID, { status: "ready" })
    assert.equal(creates().length, 1)
    assert.equal(closes.value, 1)
  }

  // A blocked reply to a pending submit ends that submit.
  {
    await mount()
    submit().click()
    const verify = checks().at(-1)!
    assert.equal(verify.verify, true)
    await reply("p1", verify.requestID, plain)
    assert.equal(creates().length, 0)
    assert.equal(closes.value, 0)
    assert.equal(document.activeElement, card()?.querySelector("[data-readiness-action]"))
    await close()
    assert.deepEqual(readiness(), [
      { stage: "identified", code: "not_git_repo", entry: "modal" },
      { stage: "abandoned", code: "not_git_repo", entry: "modal" },
    ])
  }

  // A fix owns the state even when an earlier manual check replies after it finishes.
  {
    const id = await mount()
    await reply("p1", id, plain)
    const again = Array.from(card()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (item) => item.textContent === "agentManager.readiness.check",
    )
    assert.ok(again)
    again.click()
    await settle()
    const pending = checks().at(-1)!.requestID
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    assert.equal(fix.fix, "initGit")
    assert.ok(card()?.querySelector("[role=status]"))
    assert.equal(creates().length, 0)
    card()?.querySelector<HTMLElement>("[data-readiness-title]")?.focus()
    await emit({
      type: "agentManager.readiness",
      projectId: "p1",
      requestID: fix.requestID,
      result: { status: "ready", note: "uncommitted" },
    })
    assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.initGit"))
    assert.equal(document.activeElement, submit())
    await reply("p1", pending, plain)
    assert.equal(submit().getAttribute("aria-disabled"), null)
    assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.initGit"))
    assert.equal(creates().length, 0)
    assert.equal(closes.value, 0)
    assert.deepEqual(readiness(), [
      { stage: "identified", code: "not_git_repo", entry: "modal" },
      { stage: "fix_started", code: "not_git_repo", fix: "initGit", entry: "modal" },
      { stage: "resolved", code: "not_git_repo", fix: "initGit", entry: "modal" },
    ])
  }

  // Closing a pending submit cancels it without creating or reporting a late unknown transition.
  {
    await mount()
    submit().click()
    await close()
    await reply("p1", checks().at(-1)!.requestID, { status: "ready" })
    assert.equal(creates().length, 0)
    assert.deepEqual(readiness(), [])
  }

  // An invalid branch name stops a ready submit before anything is created, cleared or closed.
  {
    const id = await mount()
    await reply("p1", id, { status: "ready" })
    const area = prompt()
    area.value = "keep me"
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
    const branch = document.querySelector<HTMLInputElement>(".am-nv-branch-input")
    assert.ok(branch)
    branch.value = "../escape"
    branch.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
    submit().click()
    await settle()
    const verify = checks().at(-1)!
    assert.equal(verify.verify, true)
    await reply("p1", verify.requestID, { status: "ready" })
    await settle()
    assert.equal(creates().length, 0)
    assert.equal(closes.value, 0)
    assert.equal(submit().disabled, false)
    assert.equal(prompt().value, "keep me")
    assert.ok(
      document.querySelector("[data-component='toast']")?.textContent?.includes("agentManager.dialog.invalidBranch"),
    )
    await close()
  }

  // With no reply before the deadline, Create behaves as it does today.
  {
    await mount()
    submit().click()
    await settle()
    assert.equal(checks().length, 2, "submit sends a verify check")
    submit().click()
    await settle()
    assert.equal(checks().length, 2, "a second activation reuses the in-flight verify")
    assert.equal(creates().length, 0)
    await new Promise((done) => setTimeout(done, 3_200))
    await settle()
    assert.equal(creates().length, 1)
    assert.equal(closes.value, 1)
  }

  // A ready result without a note omits the uncommitted-files line.
  {
    const id = await mount()
    await reply("p1", id, plain)
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    await reply("p1", fix.requestID, { status: "ready" })
    assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.initGit"))
    assert.equal(card()?.textContent?.includes("agentManager.readiness.ready.initGitNote"), false)
    await close()
  }

  // An uncommitted note shows the line.
  {
    const id = await mount()
    await reply("p1", id, plain)
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    await reply("p1", fix.requestID, { status: "ready", note: "uncommitted" })
    assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.initGitNote"))
    await close()
  }

  // A project whose branch list is empty or failed shows the no-branches state.
  {
    const id = await mount()
    await emit({ type: "agentManager.branches", projectId: "p1", branches: [], defaultBranch: "main" })
    const branch = document.querySelector<HTMLButtonElement>(".am-nv-origin-branch")
    assert.ok(branch)
    assert.ok(branch.textContent?.includes("agentManager.import.noBranchesFound"))
    assert.equal(branch.querySelector(".am-branch-badge"), null)
    await reply("p1", id, { status: "ready" })
    await close()
  }

  // A re-check that reports the same blocker does not repeat telemetry.
  {
    const id = await mount()
    await reply("p1", id, plain)
    const again = Array.from(card()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (item) => item.textContent === "agentManager.readiness.check",
    )
    assert.ok(again)
    again.click()
    await settle()
    await reply("p1", checks().at(-1)!.requestID, plain)
    assert.deepEqual(readiness(), [{ stage: "identified", code: "not_git_repo", entry: "modal" }])
    await close()
  }

  // An invalid projectId is kept, never replaced by the active project.
  {
    await mount({ projectId: "missing" })
    assert.equal(checks().at(0)?.projectId, "missing")
    assert.ok(!document.querySelector(".am-nv-origin-project")?.textContent?.includes("p1"))
    await close()
  }

  // The identity form sends the approved name and email with the fix.
  {
    const id = await mount()
    await reply("p1", id, { ...plain, identity: false })
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const inputs = card()?.querySelectorAll<HTMLInputElement>('[data-slot="input-input"]')
    assert.equal(inputs?.length, 2)
    const write = (input: HTMLInputElement, value: string) => {
      input.value = value
      input.dispatchEvent(new window.Event("input", { bubbles: true }))
    }
    write(inputs![0]!, "Ada Lovelace")
    write(inputs![1]!, "ada@example.com")
    await settle()
    card()?.querySelector<HTMLButtonElement>('form.am-readiness-form button[type="submit"]')?.click()
    await settle()
    const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    assert.equal(fix.fix, "initGit")
    assert.deepEqual(fix.identity, { name: "Ada Lovelace", email: "ada@example.com" })
    await close()
  }

  // A fix locks the project picker and the /project slash action.
  {
    const id = await mount()
    await reply("p1", id, plain)
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    const trigger = document.querySelector<HTMLButtonElement>(".am-nv-origin-project")
    assert.ok(trigger)
    assert.equal(trigger.disabled, true)
    trigger.click()
    await settle()
    assert.equal(document.querySelector(".am-nv-origin-projects"), null)
    const area = prompt()
    area.value = "/project"
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
    await settle()
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>(".slash-command-item")).find((button) =>
      button.textContent?.includes("/project"),
    )
    assert.ok(item)
    item.click()
    await settle()
    assert.equal(document.querySelector(".am-nv-origin-projects"), null)
    assert.ok(document.querySelector(".am-nv-origin-project")?.textContent?.includes("p1"))
    await close()
  }

  // A speech submit goes through the same readiness gate.
  {
    const { speechShortcutValue } = await import("../../webview-ui/src/components/speech-to-text/shortcut")
    setFeatures({ ...features(), speechToText: true })
    await emit({
      type: "providersLoaded",
      organizationId: null,
      ready: true,
      providers: { kilo: { id: "kilo", name: "Kilo", models: { m1: { id: "m1", name: "M1" } } } },
      connected: ["kilo"],
      defaults: { kilo: "m1" },
      defaultSelection: { providerID: "kilo", modelID: "m1" },
      authMethods: {},
      authStates: { kilo: "api" },
    })
    const id = await mount()
    await reply("p1", id, plain)
    const mic = document.querySelector<HTMLButtonElement>(".prompt-speech-button")
    assert.ok(mic)
    mic.click()
    await settle()
    const start = sent.find((item) => item.type === "speechToTextStart")
    assert.ok(start && start.type === "speechToTextStart")
    await emit({ type: "speechToTextStarted", requestId: start.requestId })
    const mac = speechShortcutValue() === "Meta+K"
    const down = new window.KeyboardEvent("keydown", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true })
    Object.defineProperty(down, "timeStamp", { value: 0 })
    prompt().dispatchEvent(down as never)
    const up = new window.KeyboardEvent("keyup", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true })
    Object.defineProperty(up, "timeStamp", { value: 500 })
    window.dispatchEvent(up as never)
    await settle()
    const stop = sent.find((item) => item.type === "speechToTextStop")
    assert.ok(stop && stop.type === "speechToTextStop")
    await emit({ type: "speechToTextResult", requestId: stop.requestId, text: "hello" })
    assert.equal(creates().length, 0)
    assert.equal(document.activeElement, card()?.querySelector("[data-readiness-action]"))
    await close()
  }
}

// Git and Git LFS: install from the card, finish in Apple's window, fresh-check on return,
// and offer Reload only after a terminal install that VS Code cannot see yet.
if (process.env.READINESS_CASE === "install") {
  const git: Readiness = {
    status: "blocked",
    code: "git_not_found",
    name: "p1",
    trusted: true,
    platform: "darwin",
    installer: "apple",
  }
  const lfs: Readiness = {
    status: "blocked",
    code: "lfs_missing",
    name: "orbit",
    trusted: true,
    platform: "darwin",
    installer: "brew",
  }
  const details = () => {
    const trigger = Array.from(card()?.querySelectorAll<HTMLElement>("button") ?? []).find(
      (item) => item.textContent === "error.details.show",
    )
    assert.ok(trigger)
    trigger.click()
  }
  const install = async () => {
    card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
    await settle()
    const fix = sent.filter((item) => item.type === "agentManager.fixReadiness").at(-1)
    assert.ok(fix && fix.type === "agentManager.fixReadiness")
    return fix
  }

  // Apple: Check again escapes to the Git card, and a different blocker wins.
  const apple = await mount()
  await reply("p1", apple, git)
  assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.git.title")
  assert.equal(submit().getAttribute("aria-disabled"), "true")
  const first = await install()
  assert.equal(first.fix, "installGit")
  assert.ok(card()?.querySelector("[role=status]"))
  assert.equal(creates().length, 0)
  card()?.querySelector<HTMLElement>("[data-readiness-title]")?.focus()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: first.requestID,
    result: git,
    install: { kind: "git", mode: "apple", ok: false },
  })
  assert.equal(card()?.querySelector("[role=status] span")?.textContent, "agentManager.readiness.install.apple.title")
  card()?.querySelector<HTMLButtonElement>(".am-readiness-check")?.click()
  await settle()
  const retry = checks().at(-1)
  assert.ok(retry)
  assert.equal(retry.fresh, true)
  await reply("p1", retry.requestID, git)
  assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.git.title")
  assert.ok(card()?.querySelector("[data-readiness-action]"))

  const again = await install()
  assert.equal(again.fix, "installGit")
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: again.requestID,
    result: git,
    install: { kind: "git", mode: "apple", ok: false },
  })
  assert.equal(card()?.querySelector("[role=status] span")?.textContent, "agentManager.readiness.install.apple.title")
  card()?.querySelector<HTMLButtonElement>(".am-readiness-check")?.click()
  await settle()
  const different = checks().at(-1)
  assert.ok(different)
  await reply("p1", different.requestID, {
    status: "blocked",
    code: "no_commits",
    name: "p1",
    trusted: true,
    identity: true,
  })
  assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.commit.title")
  assert.equal(card()?.querySelector("[role=status]"), null)
  assert.equal(creates().length, 0)
  await close()

  // A window-return check keeps Apple's card for an unknown or same result,
  // and a different blocker wins.
  const moved = await mount()
  await reply("p1", moved, git)
  const starting = await install()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: starting.requestID,
    result: git,
    install: { kind: "git", mode: "apple", ok: false },
  })
  for (const result of [git, { status: "unknown", detail: "timeout" }] as const) {
    await emit({ type: "agentManager.readinessFocus" })
    const focus = checks().at(-1)
    assert.ok(focus)
    await reply("p1", focus.requestID, result)
    assert.equal(card()?.querySelector("[role=status] span")?.textContent, "agentManager.readiness.install.apple.title")
  }
  await emit({ type: "agentManager.readinessFocus" })
  const focus = checks().at(-1)
  assert.ok(focus)
  await reply("p1", focus.requestID, {
    status: "blocked",
    code: "no_commits",
    name: "p1",
    trusted: true,
    identity: true,
  })
  assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.commit.title")
  await close()

  // Apple: Other ways stays live and a window return focuses Create.
  const otherway = await mount()
  await reply("p1", otherway, git)
  const opening = await install()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: opening.requestID,
    result: git,
    install: { kind: "git", mode: "apple", ok: false },
  })
  const other = Array.from(card()?.querySelectorAll<HTMLButtonElement>(".am-readiness-link") ?? []).find(
    (item) => item.textContent === "agentManager.readiness.tool.other",
  )
  assert.ok(other)
  other.click()
  await settle()
  const download = sent.find((item) => item.type === "agentManager.fixReadiness" && item.fix === "downloadGit")
  assert.ok(download && download.type === "agentManager.fixReadiness")
  await emit({ type: "agentManager.readiness", projectId: "p1", requestID: download.requestID, result: git })
  assert.equal(card()?.querySelector("[role=status] span")?.textContent, "agentManager.readiness.install.apple.title")
  card()?.querySelector<HTMLButtonElement>(".am-readiness-check")?.focus()
  await emit({ type: "agentManager.readinessFocus" })
  const fresh = checks().at(-1)
  assert.ok(fresh)
  assert.equal(fresh.fresh, true)
  await reply("p1", fresh.requestID, { status: "ready" })
  assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.git"))
  assert.equal(submit().getAttribute("aria-disabled"), null)
  assert.equal(document.activeElement, submit())
  assert.equal(creates().length, 0)
  await close()

  // A focused prompt keeps focus after a window-return recovery.
  const typing = await mount()
  await reply("p1", typing, git)
  const started = await install()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: started.requestID,
    result: git,
    install: { kind: "git", mode: "apple", ok: false },
  })
  const input = document.querySelector<HTMLTextAreaElement>(".am-prompt-input")
  assert.ok(input)
  input.focus()
  await emit({ type: "agentManager.readinessFocus" })
  const typed = checks().at(-1)
  assert.ok(typed)
  await reply("p1", typed.requestID, { status: "ready" })
  assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.git"))
  assert.equal(document.activeElement, input)
  await close()

  // A terminal install keeps Installing even when a focus check still misses it,
  // and offers no second install while the task runs.
  const second = await mount()
  await reply("p1", second, lfs)
  assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.lfs.title")
  const fix = await install()
  assert.equal(fix.fix, "installLfs")
  assert.equal(card()?.querySelectorAll("[data-readiness-action]").length, 0)
  assert.equal(card()?.querySelector(".am-readiness-check"), null)
  await emit({ type: "agentManager.readinessFocus" })
  const live = checks().at(-1)
  assert.ok(live)
  assert.equal(live.fresh, true)
  await reply("p1", live.requestID, { status: "blocked", code: "lfs_missing", name: "orbit", trusted: true })
  assert.equal(
    card()?.querySelector("[role=status] span")?.textContent,
    "agentManager.readiness.install.terminal.title",
  )
  assert.equal(sent.filter((item) => item.type === "agentManager.fixReadiness").length, 1)
  // A different blocker found while the terminal task is pending keeps Installing.
  await emit({ type: "agentManager.readinessFocus" })
  const changed = checks().at(-1)
  assert.ok(changed)
  await reply("p1", changed.requestID, {
    status: "blocked",
    code: "no_commits",
    name: "p1",
    trusted: true,
    identity: true,
  })
  assert.equal(
    card()?.querySelector("[role=status] span")?.textContent,
    "agentManager.readiness.install.terminal.title",
  )

  // A failed or stopped terminal task that still misses the tool is blocked, never Reload.
  for (const [detail, outcome] of [
    ["agentManager.readiness.install.failed", { ok: false, code: 1 }],
    ["agentManager.readiness.install.stopped", { ok: false, stopped: true }],
  ] as const) {
    const page = await mount()
    await reply("p1", page, lfs)
    const task = await install()
    await emit({
      type: "agentManager.readiness",
      projectId: "p1",
      requestID: task.requestID,
      result: lfs,
      install: { kind: "lfs", mode: "terminal", ...outcome },
    })
    assert.equal(card()?.querySelector("[data-readiness-title]")?.textContent, "agentManager.readiness.lfs.title")
    details()
    assert.ok(card()?.querySelector(".am-readiness-details")?.textContent?.includes(detail))
    assert.equal(card()?.querySelector(".am-readiness-check")?.textContent, "agentManager.readiness.check")
    assert.equal(
      sent.some((item) => item.type === "agentManager.reloadWindow"),
      false,
    )
    await close()
  }

  // An older check reply must not re-block Create after an install settles.
  const racing = await mount()
  await reply("p1", racing, lfs)
  const task = await install()
  await emit({ type: "agentManager.readinessFocus" })
  const older = checks().at(-1)
  assert.ok(older)
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: task.requestID,
    result: { status: "ready" },
    install: { kind: "lfs", mode: "terminal", ok: true },
  })
  assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.lfs"))
  assert.equal(submit().getAttribute("aria-disabled"), null)
  await reply("p1", older.requestID, lfs)
  assert.ok(card()?.textContent?.includes("agentManager.readiness.ready.lfs"))
  assert.equal(submit().getAttribute("aria-disabled"), null)
  await close()

  // A successful terminal install that VS Code cannot see yet is the only path to Reload.
  const third = await mount()
  await reply("p1", third, lfs)
  const stale = await install()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: stale.requestID,
    result: lfs,
    install: { kind: "lfs", mode: "terminal", ok: true },
  })
  assert.equal(
    card()?.querySelector("[data-readiness-title]")?.textContent,
    "agentManager.readiness.install.stale.title",
  )
  assert.ok(card()?.textContent?.includes("agentManager.readiness.install.stale.body"))
  assert.equal(card()?.querySelector(".am-readiness-check")?.textContent, "agentManager.readiness.check")
  assert.equal(
    sent.some((item) => item.type === "agentManager.reloadWindow"),
    false,
  )
  // Check again from stale keeps the stale card (Reload) until it is actually ready.
  card()?.querySelector<HTMLButtonElement>(".am-readiness-check")?.click()
  await settle()
  const staleCheck = checks().at(-1)
  assert.ok(staleCheck)
  await reply("p1", staleCheck.requestID, lfs)
  assert.equal(
    card()?.querySelector("[data-readiness-title]")?.textContent,
    "agentManager.readiness.install.stale.title",
  )
  card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
  await settle()
  assert.equal(saved.advancedDialogReopen, true)
  assert.equal(
    sent.some((item) => item.type === "agentManager.reloadWindow"),
    true,
  )
  assert.equal(creates().length, 0)
  await close()

  // Focus is ignored unless a Git/LFS card is showing.
  const healthy = await mount()
  await reply("p1", healthy, { status: "ready" })
  const before = checks().length
  await emit({ type: "agentManager.readinessFocus" })
  assert.equal(checks().length, before)
  await close()

  const commits = await mount()
  await reply("p1", commits, { status: "blocked", code: "no_commits", name: "p1", trusted: true, identity: true })
  const blocked = checks().length
  await emit({ type: "agentManager.readinessFocus" })
  assert.equal(checks().length, blocked)
}

// A card for the picked folder sets up that folder, not the selected project.
{
  const id = await mount()
  await reply("p1", id, {
    status: "blocked",
    code: "not_git_repo",
    name: "picked",
    trusted: true,
    identity: true,
    picked: true,
  })
  card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
  await settle()
  const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
  assert.ok(fix && fix.type === "agentManager.fixReadiness")
  assert.equal(fix.fix, "initGit")
  assert.equal(fix.target, "picked")
  await close()
}

// A ready fix keeps focus in the branch-name input.
{
  const id = await mount()
  await reply("p1", id, plain)
  card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
  await settle()
  const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
  assert.ok(fix && fix.type === "agentManager.fixReadiness")
  const branch = document.querySelector<HTMLInputElement>(".am-nv-branch-input")
  assert.ok(branch)
  branch.focus()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: fix.requestID,
    result: { status: "ready" },
  })
  await settle()
  assert.equal(document.activeElement, branch, "m4: branch focus")
  await close()
}

// More than three child repos show one primary folder action instead of a list.
{
  const id = await mount()
  await reply("p1", id, {
    status: "blocked",
    code: "not_git_repo",
    name: "parent",
    trusted: true,
    projects: [
      { root: "/a", label: "a" },
      { root: "/b", label: "b" },
      { root: "/c", label: "c" },
    ],
    more: true,
  })
  assert.ok(!card()?.textContent?.includes("agentManager.readiness.projects.use"))
  const action = card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")
  assert.ok(action)
  assert.equal(action.textContent, "agentManager.readiness.restricted.action")
  action.click()
  await settle()
  const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
  assert.ok(fix && fix.type === "agentManager.fixReadiness")
  assert.equal(fix.fix, "pickFolder")
  await close()
}

// A ready fix does not steal focus from the prompt.
{
  const id = await mount()
  await reply("p1", id, plain)
  card()?.querySelector<HTMLButtonElement>("[data-readiness-action]")?.click()
  await settle()
  const fix = sent.find((item) => item.type === "agentManager.fixReadiness")
  assert.ok(fix && fix.type === "agentManager.fixReadiness")
  const area = prompt()
  area.focus()
  await emit({
    type: "agentManager.readiness",
    projectId: "p1",
    requestID: fix.requestID,
    result: { status: "ready" },
  })
  await settle()
  assert.equal(document.activeElement, area, "b6: prompt focus")
  assert.equal(creates().length, 0)
  await close()
}

dispose()
await window.happyDOM.abort()
window.close()
