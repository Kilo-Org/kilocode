import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "agentmanager--full-screen-diff-agent-edit-scroll"
const INLINE_STORY_ID = "agentmanager--diff-panel-scroll-up"
const CACHE_STORY_ID = "agentmanager--diff-panel-cached-worktree-switch"
const VIEWPORT_STORY_ID = "agentmanager--diff-panel-viewport-loading"
const TREE_STORY_ID = "agentmanager--file-tree-virtualized-large"

function storyUrl() {
  return `/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`
}

function inlineStoryUrl() {
  return `/iframe.html?id=${INLINE_STORY_ID}&viewMode=story&globals=${GLOBALS}`
}

async function disableAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  })
}

async function openStory(page: Page) {
  await page.setViewportSize({ width: 800, height: 720 })
  await page.addInitScript(() => {
    const win = window as Window & { nativeIntersectionObserver?: typeof IntersectionObserver }
    win.nativeIntersectionObserver = window.IntersectionObserver
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined, writable: true })
  })
  await page.goto(storyUrl(), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })

  const first = page.locator('[data-file-path="src/agent-edit.ts"] [data-component="diff"]')
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(3_000)
  return first
}

async function showTarget(page: Page) {
  const target = page.locator('[data-file-path="src/target.ts"]')
  await page.locator(".am-review-diff").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(target).toBeAttached()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return target
}

async function alignTarget(page: Page) {
  await page.locator(".am-review-diff").evaluate((el) => {
    const target = el.querySelector('[data-file-path="src/target.ts"]')
    if (!(target instanceof HTMLElement)) throw new Error("Target diff row not found")
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 24
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

for (const width of [420, 200]) {
  test(`keeps PR-panel headers stable above inline threads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const story = width === 200 ? "agentmanager--pr-panel-comments-200" : "agentmanager--pr-panel-comments"
    await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
    await disableAnimations(page)
    const card = page.locator('[data-thread-id="PRRT_1"]')
    const header = card.locator(".am-pr-comment-head")
    const diff = card.locator(".am-pr-diff-thread")
    const annotation = diff.locator(".am-pr-thread-annotation")
    await expect(card).toBeVisible()
    await header.scrollIntoViewIfNeeded()
    await header.focus()
    const original = await header.evaluateHandle((el) => el)
    const position = await header.evaluate((el) => ({
      x: el.getBoundingClientRect().x,
      y: el.getBoundingClientRect().y,
    }))

    async function stable() {
      await expect(card).toHaveCount(1)
      await expect(header).toHaveCount(1)
      await expect(header).toBeFocused()
      expect(await header.evaluate((el, original) => el === original, original)).toBe(true)
      await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().x)).toBeCloseTo(position.x, 0)
      await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().y)).toBeCloseTo(position.y, 0)
    }

    async function inline() {
      await expect(header).toHaveAttribute("aria-expanded", "true")
      await expect(header.locator(".am-pr-comment-preview")).toHaveCount(0)
      await expect(diff.locator(".am-pr-diff-context-marker + [data-component='diff']")).toHaveCount(0)
      await expect(annotation.locator(".am-pr-comment-head")).toHaveCount(0)
      await expect(annotation.locator(".am-pr-comment-body").first()).toContainText("This throws when")
      await expect(annotation.locator(".am-pr-comment-reply")).toHaveCount(1)
      await expect(annotation.locator(".am-pr-comment-actions")).toHaveCount(1)
      await expect
        .poll(() =>
          header.evaluate((el) => {
            const diff = el.parentElement?.querySelector(".am-pr-diff-thread")
            return (
              !el.closest(".am-pr-thread-annotation") &&
              !!diff &&
              !!(el.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              el.getBoundingClientRect().bottom <= diff.getBoundingClientRect().top + 1
            )
          }),
        )
        .toBe(true)
      await expect
        .poll(() =>
          annotation.evaluate((el) => {
            const wrapper = el.closest<HTMLElement>("[slot]")
            const root = el.closest("diffs-container")?.shadowRoot
            const lines = [...(root?.querySelectorAll<HTMLElement>("[data-content] [data-line]") ?? [])]
            const target = lines.find((line) => line.getAttribute("data-line-type") === "change-addition")
            const next = lines.find((line) => line.textContent?.includes("return result"))
            const bounds = el.getBoundingClientRect()
            return (
              wrapper?.assignedSlot?.name === "annotation-additions-42" &&
              !!target &&
              !!next &&
              bounds.top >= target.getBoundingClientRect().bottom - 1 &&
              next.getBoundingClientRect().top >= bounds.bottom - 1 &&
              bounds.width <= innerWidth
            )
          }),
        )
        .toBe(true)
    }

    await inline()
    for (const input of ["click", "Enter", "Space"]) {
      if (input === "click") await header.click()
      if (input !== "click") await page.keyboard.press(input)
      await expect(diff).toHaveCount(0)
      await expect(card.locator(".am-pr-comment-body")).toHaveCount(0)
      await expect(header).toHaveAttribute("aria-expanded", "false")
      await expect(header.locator(".am-pr-comment-preview")).toContainText("This throws when")
      await stable()
      if (input === "click") await header.click()
      if (input !== "click") await page.keyboard.press(input)
      await inline()
      await stable()
    }
    await original.dispose()
  })
}

test("preserves diff scroll position while an agent edit refreshes a file", async ({ page }) => {
  const first = await openStory(page)
  const scroller = page.locator(".am-review-diff")

  // The initial tall diff rendered eagerly. Restore the real observer before
  // moving it offscreen so an unfixed row remount takes the deferred path.
  await page.evaluate(() => {
    const win = window as Window & { nativeIntersectionObserver?: typeof IntersectionObserver }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: win.nativeIntersectionObserver,
      writable: true,
    })
  })

  const target = await showTarget(page)

  await alignTarget(page)
  await alignTarget(page)

  const before = await scroller.evaluate((el) => el.scrollTop)
  const top = await target.evaluate((el) => el.getBoundingClientRect().top)
  expect(before).toBeGreaterThan(3_000)

  await page.getByRole("button", { name: "Apply agent edit" }).click()
  await expect(page.getByTestId("agent-edit-version")).toHaveText("after")
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(3_000)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const after = await scroller.evaluate((el) => el.scrollTop)
  const next = await target.evaluate((el) => el.getBoundingClientRect().top)
  expect(after).toBeCloseTo(before, 0)
  expect(next).toBeCloseTo(top, 0)
})

test("preserves scroll while adding and editing a review comment", async ({ page }) => {
  await openStory(page)
  const scroller = page.locator(".am-review-diff")
  const target = await showTarget(page)

  await alignTarget(page)
  await alignTarget(page)

  const line = target.locator('[data-line="1"]').last()
  await line.hover()
  await target.locator("[data-utility-button]").last().click()
  await expect(target.locator(".am-annotation-textarea")).toBeVisible()
  await target.locator(".am-annotation-textarea").fill("Keep this stable")
  const top = await target.evaluate((el) => el.getBoundingClientRect().top)
  const before = await scroller.evaluate((el) => el.scrollTop)

  await page.getByRole("button", { name: "Apply agent edit" }).click()
  await expect(page.getByTestId("agent-edit-version")).toHaveText("after")
  await expect(target.locator(".am-annotation-textarea")).toHaveValue("Keep this stable")
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0)
  await expect.poll(async () => target.evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(top, 0)

  await target.getByRole("button", { name: "Comment" }).click()
  await expect(target.getByText("Keep this stable")).toBeVisible()
  const saved = await scroller.evaluate((el) => el.scrollTop)

  await target.getByTitle("Edit").click()
  await target.locator(".am-annotation-textarea").fill("Still stable")
  await target.getByRole("button", { name: "Save" }).click()
  await expect(target.getByText("Still stable")).toBeVisible()
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(saved, 0)
})

for (const modifier of ["Meta", "Control"] as const) {
  test(`sends all review comments on the second ${modifier}+Enter before the next frame`, async ({ page }) => {
    await openStory(page)
    const target = await showTarget(page)
    await alignTarget(page)

    for (const text of ["First comment", "Second comment"]) {
      await target.locator('[data-line="1"]').last().hover()
      await target.locator("[data-utility-button]").last().click()
      await target.locator(".am-annotation-textarea").fill(text)
      if (text === "First comment") {
        await target.getByRole("button", { name: "Comment", exact: true }).click()
        await expect(target.getByText(text, { exact: true })).toBeVisible()
      }
    }

    await page.keyboard.press("Shift+Enter")
    await expect(target.locator(".am-annotation-textarea")).toHaveValue("Second comment\n")

    const result = await page.evaluate((modifier) => {
      const sent: Array<{ comments: Array<{ comment: string }>; autoSend: boolean }> = []
      const listener = (event: MessageEvent) => {
        if (event.data?.type === "appendReviewComments") sent.push(event.data)
      }
      window.addEventListener("message", listener)
      const press = () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            metaKey: modifier === "Meta",
            ctrlKey: modifier === "Control",
            bubbles: true,
            composed: true,
            cancelable: true,
          }),
        )
      press()
      const first = sent.length
      press()
      const second = sent.length
      press()
      window.removeEventListener("message", listener)
      return { first, second, sent }
    }, modifier)

    expect(result.first).toBe(0)
    expect(result.second).toBe(1)
    expect(result.sent).toHaveLength(1)
    expect(result.sent.at(0)).toMatchObject({
      comments: [{ comment: "First comment" }, { comment: "Second comment" }],
      autoSend: true,
    })
    await expect(page.locator(".am-annotation")).toHaveCount(0)
  })
}

test("resets virtual measurements and scroll when the review context changes", async ({ page }) => {
  const first = await openStory(page)
  const scroller = page.locator(".am-review-diff")
  await page.evaluate(() => {
    class IdleObserver {
      readonly root = null
      readonly rootMargin = "0px"
      readonly thresholds = []

      disconnect() {}
      observe() {}
      takeRecords() {
        return []
      }
      unobserve() {}
    }

    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: IdleObserver,
      writable: true,
    })
  })

  // Move away from the origin so the context switch must reset both the
  // virtualizer's cached measurements and the shared scroller position.
  await scroller.evaluate((el) => {
    el.scrollTop = 2_000
  })
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1_000)

  await page.getByRole("button", { name: "Switch review context" }).click()
  await expect(page.getByTestId("review-context")).toHaveText("changed-context")
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBe(1_200)
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBe(0)
})

test("keeps the inline diff position stable while scrolling upward", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.goto(inlineStoryUrl(), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector(".am-diff-content diffs-container", { state: "attached" })

  const result = await page.locator(".am-diff-content").evaluate(async (el) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const settle = async (count: number) => {
      for (let i = 0; i < count; i++) await frame()
    }
    const seen = new Set(
      Array.from(el.querySelectorAll("[data-file-path]"), (row) => row.getAttribute("data-file-path")),
    )
    let remounts = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          const rows = node.matches("[data-file-path]") ? [node] : Array.from(node.querySelectorAll("[data-file-path]"))
          for (const row of rows) {
            const file = row.getAttribute("data-file-path")
            if (seen.has(file)) remounts++
            seen.add(file)
          }
        }
      }
    })
    observer.observe(el, { childList: true, subtree: true })

    // Materialize every row once, then start from the settled bottom. The bug
    // appears when upward scrolling re-creates rows above the viewport.
    while (el.scrollTop < el.scrollHeight - el.clientHeight - 1) {
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + 120)
      await frame()
    }
    await settle(30)

    let correction = 0
    let range = 0
    while (el.scrollTop > 0) {
      const height = el.scrollHeight
      const intended = Math.max(0, el.scrollTop - 80)
      el.scrollTop = intended
      await settle(2)
      correction = Math.max(correction, Math.abs(el.scrollTop - intended))
      range = Math.max(range, Math.abs(el.scrollHeight - height))
    }
    observer.disconnect()
    return { correction, range, remounts }
  })

  expect(result.remounts).toBeGreaterThan(0)
  expect(result.correction).toBeLessThanOrEqual(1)
  expect(result.range).toBeLessThanOrEqual(1)
})

test("keeps cached worktree reviews visible on every switch frame", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.goto(`/iframe.html?id=${CACHE_STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await disableAnimations(page)

  for (let index = 1; index <= 12; index++) {
    await page.getByTestId(`select-worktree-${index}`).click()
    await expect(page.locator(".am-diff-panel-cache-active [data-file-path]")).toHaveAttribute(
      "data-file-path",
      `src/worktree-${index}.ts`,
    )
    await expect(page.locator(".am-diff-panel-cache-active diffs-container [data-line]").first()).toBeVisible()
  }

  const result = await page.evaluate(async () => {
    const frames: Array<{ id: string; immediate: boolean; painted: boolean; remounted: boolean; rebuilt: boolean }> = []
    const panels = new Map<string, Element>()
    const lines = new Map<string, Element>()
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let index = 1; index <= 12; index++) {
        const id = `worktree-${index}`
        const button = document.querySelector<HTMLButtonElement>(`[data-testid="select-${id}"]`)
        if (!button) throw new Error(`Missing worktree ${id}`)
        button.click()
        const panel = document.querySelector(".am-diff-panel-cache-active")
        const known = panels.get(id)
        const remounted = known !== undefined && known !== panel
        if (panel) panels.set(id, panel)
        const visible = () => {
          const row = document.querySelector(".am-diff-panel-cache-active [data-file-path]")
          if (row?.getAttribute("data-file-path") !== `src/${id}.ts`) return false
          const line = row.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]")
          return Boolean(line?.textContent?.trim() && line.getBoundingClientRect().height > 0)
        }
        const immediate = visible()
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const line = panel?.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]")
        const previous = lines.get(id)
        const rebuilt = previous !== undefined && previous !== line
        if (line) lines.set(id, line)
        frames.push({ id, immediate, painted: visible(), remounted, rebuilt })
      }
    }
    return {
      frames,
      blank: frames.filter((frame) => !frame.immediate || !frame.painted),
      remounts: frames.filter((frame) => frame.remounted),
      rebuilds: frames.filter((frame) => frame.rebuilt),
      panels: document.querySelectorAll(".am-diff-panel-cache").length,
      active: document.querySelectorAll(".am-diff-panel-cache-active").length,
      hidden: [...document.querySelectorAll(".am-diff-panel-cache:not(.am-diff-panel-cache-active)")].every(
        (panel) => getComputedStyle(panel).contentVisibility === "hidden",
      ),
    }
  })

  expect(result.blank).toEqual([])
  expect(result.remounts).toEqual([])
  expect(result.rebuilds).toEqual([])
  expect(result.panels).toBe(12)
  expect(result.active).toBe(1)
  expect(result.hidden).toBe(true)
})

test("loads only visible diff details and fetches distant rows when scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.goto(`/iframe.html?id=${VIEWPORT_STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await disableAnimations(page)

  const root = page.getByTestId("viewport-diff-review")
  const scroll = page.locator(".am-diff-content")
  await expect(scroll).toBeVisible()
  await expect.poll(async () => Number(await root.getAttribute("data-request-count"))).toBeGreaterThan(0)
  await expect(root.locator("diffs-container [data-line]").first()).toBeVisible()

  const initial = Number(await root.getAttribute("data-request-count"))
  expect(initial).toBeLessThan(30)
  expect(await root.getAttribute("data-requested")).not.toContain("src/file-119.ts")
  await expect(root).toHaveAttribute("data-offscreen", "")

  await expect
    .poll(
      async () => {
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        return (await root.getAttribute("data-requested"))?.includes("src/file-119.ts") ?? false
      },
      { timeout: 10_000 },
    )
    .toBe(true)

  expect(Number(await root.getAttribute("data-request-count"))).toBeLessThan(40)
  await expect(root).toHaveAttribute("data-offscreen", "")
})

test("resumes interrupted visible diff content without requiring a new summary", async ({ page }) => {
  await page.goto(`/iframe.html?id=agentmanager--diff-panel-interrupted-loading&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
  const root = page.getByTestId("interrupted-review")
  await expect(root).toHaveAttribute("data-requests", "1")
  await page.getByTestId("interrupt-review").click()
  await page.getByTestId("resume-review").click()
  await expect(root).toHaveAttribute("data-requests", "2")
  await expect(root.locator("diffs-container [data-line]").filter({ hasText: "after" })).toBeVisible()
})

test("virtualizes large review file trees while preserving navigation", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.goto(`/iframe.html?id=${TREE_STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await disableAnimations(page)

  const root = page.getByTestId("large-file-tree")
  const scroll = root.locator(".am-file-tree-list")
  const files = root.locator(".am-file-tree-file")
  await expect(scroll).toBeVisible()
  await expect.poll(async () => files.count()).toBeGreaterThan(0)
  expect(await files.count()).toBeLessThan(80)

  await expect
    .poll(
      async () => {
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        return root.getByText("file-0599.ts").count()
      },
      { timeout: 10_000 },
    )
    .toBe(1)

  await root.getByText("file-0599.ts").click()
  await expect(root).toHaveAttribute("data-selected", "src/group-19/file-0599.ts")
  expect(await files.count()).toBeLessThan(80)

  await scroll.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(root.locator(".am-file-tree-dir").first()).toBeVisible()
  await root.locator(".am-file-tree-dir").first().click()
  await expect(files).toHaveCount(0)
  await root.locator(".am-file-tree-dir").first().click()
  await expect.poll(async () => files.count()).toBeGreaterThan(0)
})
