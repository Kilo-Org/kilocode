import { expect, test, type Page } from "@playwright/test"

/**
 * The row above the composer swaps the working indicator for the session
 * actions when a turn finishes. It used to grow by the actions row while the
 * in-transcript indicator placeholder shrank, and the leftover difference
 * pushed the conversation text up by a few pixels on every turn boundary.
 *
 * Measure the real geometry across that swap: the dock height, the transcript
 * viewport height, and the on-screen position of the last message all have to
 * stay put.
 */

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "chat--chat-view-session-dock-stability"

async function openStory(page: Page, motion = false) {
  await page.setViewportSize({ width: 720, height: 640 })
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  // Geometry assertions need settled layout, so motion is off unless the test is
  // about the motion itself.
  if (!motion) {
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`,
    })
  }
  await page.waitForSelector('[data-component="session-dock"]')
  // Every assertion here is a width or a position, so nothing may be measured
  // while the bundled font is still swapping in.
  await page.evaluate(() => document.fonts.ready)
}

async function geometry(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const list = document.querySelector(".message-list")
    if (!(dock instanceof HTMLElement) || !(list instanceof HTMLElement)) throw new Error("dock or transcript missing")
    return {
      dock: dock.getBoundingClientRect().height,
      viewport: list.getBoundingClientRect().height,
      transcriptBottom: list.getBoundingClientRect().bottom,
    }
  })
}

test("session dock keeps the transcript still across the working swap", async ({ page }) => {
  await openStory(page)

  const idle = await geometry(page)
  expect(idle.dock).toBeGreaterThan(0)

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".working-indicator")).toBeVisible()
  const working = await geometry(page)

  expect(working.dock).toBe(idle.dock)
  expect(working.viewport).toBe(idle.viewport)
  expect(working.transcriptBottom).toBe(idle.transcriptBottom)

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".new-task-button-wrapper")).toBeVisible()
  const back = await geometry(page)

  expect(back.dock).toBe(idle.dock)
  expect(back.viewport).toBe(idle.viewport)
  expect(back.transcriptBottom).toBe(idle.transcriptBottom)
})

test("only one of the two states is visible in the dock", async ({ page }) => {
  await openStory(page)

  // Both states stay laid out so the row keeps reserving the taller height;
  // only visibility changes.
  await expect(page.locator('[data-component="session-dock"] .new-task-button-wrapper')).toBeVisible()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeHidden()

  await page.getByTestId("toggle-busy").click()

  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()
  await expect(page.locator('[data-component="session-dock"] .new-task-button-wrapper')).toBeHidden()
})

/**
 * The dock owns the space above the composer. A gutter left on only one of its
 * two states put a gap under the actions row that the working indicator did not
 * have, so the row moved by that gutter on every turn boundary.
 */
test("both dock states sit flush on the prompt", async ({ page }) => {
  await openStory(page)

  const measure = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return page.evaluate(() => {
      const dock = document.querySelector('[data-component="session-dock"]')
      const prompt = document.querySelector(".chat-input > .prompt-input-container")
      if (!(dock instanceof HTMLElement) || !(prompt instanceof HTMLElement)) throw new Error("dock or prompt missing")
      return {
        gap: prompt.getBoundingClientRect().top - dock.getBoundingClientRect().bottom,
        top: prompt.getBoundingClientRect().top,
        margin: getComputedStyle(prompt).marginTop,
      }
    })
  }

  await expect(page.locator('[data-component="session-dock"] .new-task-button-wrapper')).toBeVisible()
  const idle = await measure()

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()
  const working = await measure()

  expect(idle.gap).toBe(0)
  expect(working.gap).toBe(0)
  expect(idle.margin).toBe("0px")
  expect(working.margin).toBe("0px")
  // Same spacing on both sides of the swap, so the composer cannot jump.
  expect(working.top).toBe(idle.top)
})

test("the indicator stays a centered lane on a wide surface", async ({ page }) => {
  await openStory(page)
  // Agent Manager width: a full-width indicator put the spinner at the far-left
  // edge and pinned the elapsed time to the far-right edge.
  await page.setViewportSize({ width: 1400, height: 640 })
  await page.getByTestId("toggle-busy").click()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()

  const lane = await page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const indicator = document.querySelector(".working-indicator")
    if (!(dock instanceof HTMLElement) || !(indicator instanceof HTMLElement)) throw new Error("dock missing")
    const d = dock.getBoundingClientRect()
    // Measure the painted cluster (spinner, label, counter), not the box around it.
    const parts = [...indicator.children].map((el) => el.getBoundingClientRect())
    const left = Math.min(...parts.map((p) => p.left))
    const right = Math.max(...parts.map((p) => p.right))
    return {
      dockWidth: d.width,
      clusterWidth: right - left,
      leftGap: left - d.left,
      rightGap: d.right - right,
      spread: right - left,
    }
  })

  // The cluster stays compact instead of reaching for both edges of the surface.
  expect(lane.clusterWidth).toBeLessThan(lane.dockWidth / 2)
  // and sits on the dock's centre axis, like the actions row it replaces.
  expect(lane.leftGap).toBeGreaterThan(0)
  expect(Math.abs(lane.leftGap - lane.rightGap)).toBeLessThanOrEqual(2)
})

for (const width of [340, 532, 720, 1400]) {
  test(`goal preserves session actions and spinner geometry at ${width}px`, async ({ page }) => {
    await openStory(page)
    await page.setViewportSize({ width, height: 640 })
    const spinner = page.locator('.working-indicator [data-component="spinner"]')
    await page.getByTestId("toggle-busy").click()
    await expect(spinner).toBeVisible()
    // CSS motion overrides do not clear StatusText's JavaScript width lock.
    await expect(page.locator(".working-status")).not.toHaveAttribute("data-swap")
    const baseline = await spinner.boundingBox()
    await page.getByTestId("toggle-busy").click()
    await page.getByTestId("toggle-goal").click()

    const actions = page.locator(".session-actions-row")
    const goal = actions.locator(".session-goal-action")
    const status = page.getByRole("img", { name: "Goal: Active" })
    await expect(goal).toBeVisible()
    await expect(goal.locator("svg").first()).toHaveAttribute("viewBox", "0 0 20 20")
    await expect(goal.locator("svg").first().locator("circle")).toHaveCount(3)
    await expect(status).toBeHidden()
    for (const name of ["New Session", "Fork Session", "Move to Worktree"]) {
      await expect(actions.getByRole("button", { name, exact: true })).toBeVisible()
    }
    const style = (el: Element) => {
      const css = getComputedStyle(el)
      return {
        height: el.getBoundingClientRect().height,
        font: css.fontSize,
        padding: css.padding,
        background: css.backgroundColor,
      }
    }
    expect(await goal.evaluate(style)).toEqual(
      await actions.getByRole("button", { name: "Fork Session", exact: true }).evaluate(style),
    )
    const anchor = await goal.boundingBox()
    const dock = await page.locator(".session-dock").boundingBox()
    if (!anchor || !dock) throw new Error("Goal or session dock missing")
    for (const button of await actions.locator("button:not(.session-goal-action)").all()) {
      const box = await button.boundingBox()
      if (!box) throw new Error("Session action missing")
      expect(box.x).toBeGreaterThanOrEqual(dock.x)
      expect(box.x + box.width).toBeLessThanOrEqual(dock.x + dock.width)
      expect(box.y + box.height).toBeLessThanOrEqual(dock.y + dock.height)
      expect(box.x + box.width <= anchor.x || box.y + box.height <= anchor.y || box.y >= anchor.y + anchor.height).toBe(
        true,
      )
    }

    const idle = await geometry(page)
    await goal.click()
    await expect(page.getByRole("menuitem", { name: "Clear goal" })).toBeVisible()
    await page.getByTestId("toggle-busy").evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error("Status control missing")
      el.click()
    })
    await expect(spinner).toBeVisible()
    await expect(status).toBeVisible()
    await expect(goal).toBeHidden()
    await expect(actions).toBeHidden()
    await expect(page.getByRole("menuitem", { name: "Clear goal" })).toBeHidden()
    await expect(page.locator(".working-status")).not.toHaveAttribute("data-swap")
    const bounds = await spinner.boundingBox()
    if (!bounds || !baseline) throw new Error("Spinner missing")
    expect(bounds.x).toBe(baseline.x)
    expect(bounds.width).toBe(baseline.width)
    expect(bounds.height).toBe(baseline.height)
    expect(await geometry(page)).toEqual(idle)
    await expect(status.locator("svg circle")).toHaveCount(3)
    if (width >= 532) {
      await expect(status.locator(".session-goal-status-content")).not.toHaveAttribute("data-compact")
      await expect(status.locator(".session-goal-status-label")).toBeVisible()
    }
    await status.hover()
    await expect(page.getByRole("tooltip")).toContainText("Keep the session controls available")
    await page.getByTestId("toggle-busy").hover()
    await page.keyboard.press("Tab")
    await status.focus()
    await expect(page.getByRole("tooltip")).toContainText("Goal: Active")
    await status.click()
    await expect(page.getByRole("menuitem", { name: "Clear goal" })).toBeHidden()
    await page.getByTestId("toggle-busy").click()
    await expect(actions).toBeVisible()
    await expect(goal).toBeVisible()
    await expect(status).toBeHidden()
    await expect(page.getByRole("menuitem", { name: "Clear goal" })).toBeHidden()
  })
}

test("goal label fits the remaining space and recovers after compaction", async ({ page }) => {
  await openStory(page)
  await page.setViewportSize({ width: 380, height: 640 })
  await page.getByTestId("toggle-goal").click()
  await page.getByTestId("toggle-busy").click()
  const status = page.getByRole("img", { name: "Goal: Active" })
  const label = status.locator(".session-goal-status-label")
  await expect(status.locator(".session-goal-status-content")).not.toHaveAttribute("data-compact")
  await expect(label).toBeVisible()

  await page.getByTestId("next-status").click()
  await expect(status.locator(".session-goal-status-content")).toHaveAttribute("data-compact", "")
  await expect(status.locator("svg")).toBeVisible()
  await status.hover()
  await expect(page.getByRole("tooltip")).toContainText("Keep the session controls available")

  await page.setViewportSize({ width: 660, height: 640 })
  await expect(status.locator(".session-goal-status-content")).not.toHaveAttribute("data-compact")
  await expect(label).toBeVisible()
  await page.setViewportSize({ width: 380, height: 640 })
  await expect(status.locator(".session-goal-status-content")).toHaveAttribute("data-compact", "")
  await page.getByTestId("next-status").click()
  await expect(status.locator(".session-goal-status-content")).not.toHaveAttribute("data-compact")

  await page.locator(".chat-view").evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error("Chat missing")
    el.style.display = "none"
  })
  await expect(status).toBeHidden()
  await page.locator(".chat-view").evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error("Chat missing")
    el.style.removeProperty("display")
  })
  await expect(status).toBeVisible()
  await expect(status.locator(".session-goal-status-content")).not.toHaveAttribute("data-compact")
  await expect(label).toBeVisible()
})

test("the counter keeps its width as it ticks", async ({ page }) => {
  await openStory(page)
  await page.getByTestId("toggle-busy").click()
  const elapsed = page.locator(".working-elapsed")
  await expect(elapsed).toBeVisible()

  // A one-character growth (9s to 10s) must not reflow the cluster.
  const before = await elapsed.evaluate((el) => el.getBoundingClientRect().width)
  const wide = await elapsed.evaluate((el) => {
    const original = el.textContent
    el.textContent = "10s"
    const width = el.getBoundingClientRect().width
    el.textContent = original
    return width
  })

  expect(wide).toBe(before)
})

// Both motion preferences are emulated explicitly: the swap has two different
// behaviours and neither should depend on the ambient default.
test.describe("status swap", () => {
  test("a status change glides the cluster instead of jumping", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await openStory(page, true)
    await page.getByTestId("toggle-busy").click()
    const label = page.locator(".working-status")
    await expect(label).toBeVisible()
    await page.waitForFunction(() => !document.querySelector(".working-status[data-swap]"))

    // "Thinking…" to "Searching the codebase" is wide enough that a bare label
    // swap moved the centered spinner by tens of pixels in a single frame.
    const swap = await page.evaluate(async () => {
      const spinner = document.querySelector('.working-indicator [data-component="spinner"]')
      const box = document.querySelector(".working-status")
      const next = document.querySelector('[data-testid="next-status"]')
      if (!(spinner instanceof Element) || !(box instanceof HTMLElement) || !(next instanceof HTMLElement))
        throw new Error("indicator missing")

      const left = () => spinner.getBoundingClientRect().left
      const start = left()
      const duration = getComputedStyle(box).transitionDuration
      next.click()

      const frames: { left: number; width: string; lines: number }[] = []
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        frames.push({
          left: left(),
          width: box.style.width,
          lines: box.querySelectorAll(".working-status-line").length,
        })
      }
      return { start, duration, frames }
    })

    // The width is animated rather than reassigned.
    expect(swap.duration).not.toBe("0s")
    // In the frame of the swap the box still holds the outgoing width, so the
    // spinner starts from exactly where it was instead of teleporting.
    expect(Math.abs(swap.frames[0]!.left - swap.start)).toBeLessThanOrEqual(1)
    expect(swap.frames[0]!.width).not.toBe("")
    // Both labels are mounted for the crossfade.
    expect(swap.frames[0]!.lines).toBe(2)
    // and the cluster only ever travels toward its new position.
    for (const [i, frame] of swap.frames.entries()) {
      if (i === 0) continue
      expect(frame.left).toBeLessThanOrEqual(swap.frames[i - 1]!.left)
    }

    // Once the glide lands, the lock is released and only the new label is left.
    await page.waitForFunction(() => !document.querySelector(".working-status[data-swap]"))
    expect(await label.evaluate((el) => el.style.width)).toBe("")
    expect(await label.locator(".working-status-line").count()).toBe(1)
    const settled = await page
      .locator('.working-indicator [data-component="spinner"]')
      .evaluate((el) => el.getBoundingClientRect().left)
    expect(settled).toBeLessThan(swap.start)
  })

  test("reduced motion cuts to the new status instead of animating it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openStory(page, true)
    await page.getByTestId("toggle-busy").click()
    await expect(page.locator(".working-status")).toBeVisible()
    await page.getByTestId("next-status").click()

    const swap = await page.locator(".working-status").evaluate((el) => {
      const old = el.querySelector(".working-status-line[data-old]")
      return {
        glide: getComputedStyle(el).transitionDuration,
        // The outgoing copy has no fade to carry it away, so it must not paint on
        // top of the new label.
        old: old ? getComputedStyle(old).display : "absent",
      }
    })

    expect(swap.glide).toBe("0s")
    expect(["absent", "none"]).toContain(swap.old)
  })
})

test("a wrapped narrow-sidebar actions row is not clipped", async ({ page }) => {
  await openStory(page)
  // Narrow enough for the container query to wrap the actions row onto a
  // second line, which a hard-coded dock height cut off behind the composer.
  await page.setViewportSize({ width: 340, height: 640 })

  const wrapped = await page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const row = document.querySelector(".session-actions-row")
    if (!(dock instanceof HTMLElement) || !(row instanceof HTMLElement)) throw new Error("dock or actions missing")
    return {
      dock: dock.getBoundingClientRect().height,
      row: row.getBoundingClientRect().height,
      overflowBelow: row.getBoundingClientRect().bottom - dock.getBoundingClientRect().bottom,
    }
  })

  expect(wrapped.row).toBeGreaterThan(0)
  expect(wrapped.dock).toBeGreaterThanOrEqual(wrapped.row)
  expect(wrapped.overflowBelow).toBeLessThanOrEqual(0)

  // The swap still leaves the transcript untouched at this width.
  const idle = await geometry(page)
  await page.getByTestId("toggle-busy").click()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()
  const working = await geometry(page)

  expect(working.dock).toBe(idle.dock)
  expect(working.viewport).toBe(idle.viewport)
  expect(working.transcriptBottom).toBe(idle.transcriptBottom)
})
