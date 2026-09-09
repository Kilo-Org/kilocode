import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "chat--message-list-layout-correction"
const scrollButton = (page: Page) => page.locator(".scroll-to-bottom-button")

test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar,OverlayScrollbars"],
  },
})

async function settle(page: Page, frames = 2) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = (left: number) => {
          if (left === 0) return resolve()
          requestAnimationFrame(() => next(left - 1))
        }
        next(count)
      }),
    frames,
  )
}

async function open(page: Page) {
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await settle(page, 10)

  await list.hover()
  await page.mouse.wheel(0, -2 * (await list.evaluate((el) => el.clientHeight)))
  const bottom = scrollButton(page)
  await expect(bottom).toBeVisible()
  await settle(page, 10)
  await bottom.click()
}

async function distance(page: Page) {
  return page.locator(".message-list").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
}

async function state(page: Page) {
  return page.locator(".message-list").evaluate((el) => ({
    top: el.scrollTop,
    height: el.scrollHeight,
    distance: el.scrollHeight - el.clientHeight - el.scrollTop,
  }))
}

test("transcript navigation does not scroll the outer webview host", async ({ page }) => {
  await page.route("**/webview-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><style>
        body { margin: 0; }
        #host { margin-top: 40px; height: 600px; overflow: hidden; font: 16px/20px sans-serif; }
        iframe { width: 100%; height: 100%; border: 0; }
      </style><div id="host"><iframe src="/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}"></iframe></div>`,
    }),
  )
  await page.goto("/webview-host")
  const host = page.locator("#host")
  const frame = page.frameLocator("iframe")
  const list = frame.locator(".message-list")
  const row = frame.locator('[data-message="rail-asst-400"]').first()
  await expect(row).toBeVisible()
  for (const _ of [1, 2, 3]) await frame.getByTestId("append-stream").click()
  await expect.poll(() => row.evaluate((el) => el.clientHeight)).toBeGreaterThan(600)

  // An inline iframe leaves a baseline gap, as in VS Code's overlay wrapper.
  // Prove that the old call can scroll that wrapper before testing the real jump.
  await expect.poll(() => host.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
  await host.evaluate((el) => (el.scrollTop = 0))
  await row.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await expect.poll(() => host.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await host.evaluate((el) => (el.scrollTop = 0))
  await row.evaluate((el) => {
    window.dispatchEvent(new CustomEvent("scrollToMessage", { detail: { id: el.getAttribute("data-message") } }))
  })
  await expect
    .poll(() =>
      row.evaluate((el) => {
        const list = el.closest(".message-list")!
        return Math.abs(el.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop)
      }),
    )
    .toBeLessThanOrEqual(1)
  expect(await host.evaluate((el) => el.scrollTop)).toBe(0)

  await frame.locator(".task-header-search-toggle").press("Enter")
  const search = frame.locator('[data-slot="transcript-search-input"]')
  await search.fill("Initial streamed response.")
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await host.evaluate((el) => (el.scrollTop = 0))
  await search.press("Enter")
  await expect
    .poll(() =>
      frame.getByText("Initial streamed response.", { exact: true }).evaluate((el) => {
        const list = el.closest(".message-list")!
        const rect = el.getBoundingClientRect()
        return Math.abs(rect.top + rect.height / 2 - list.getBoundingClientRect().top - list.clientHeight / 2)
      }),
    )
    .toBeLessThanOrEqual(2)
  expect(await host.evaluate((el) => el.scrollTop)).toBe(0)
})

test("keeps following after a stable-height layout correction", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  const before = await list.evaluate((el) => ({ height: el.scrollHeight, top: el.scrollTop }))
  const corrected = await list.evaluate((el) => {
    el.scrollTop -= 120
    return { height: el.scrollHeight, top: el.scrollTop }
  })
  await settle(page)

  expect(corrected.height).toBe(before.height)
  expect(before.top - corrected.top).toBe(120)
  await expect(scrollButton(page)).toBeHidden()

  await page.getByTestId("append-stream").click()

  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)
  await expect(scrollButton(page)).toBeHidden()
})

test("keeps the reading position when the prompt rail scrolls upward", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await page.locator(".prompt-rail").hover()
  await page.mouse.wheel(0, -240)

  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(scrollButton(page)).toBeVisible()
  const top = await list.evaluate((el) => el.scrollTop)

  await page.getByTestId("append-stream").click()

  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(top)
  await expect(scrollButton(page)).toBeVisible()
})

test("pauses on a native scrollbar drag and resumes at the bottom", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await list.evaluate((el) => {
    const count = (key: "pointer" | "mouse" | "scroll") => () => {
      el.dataset[key] = String(Number(el.dataset[key] ?? "0") + 1)
    }
    const block = (event: Event) => {
      if (event.target === el) event.stopPropagation()
    }
    el.dataset.pointer = "0"
    el.dataset.mouse = "0"
    el.dataset.scroll = "0"
    el.addEventListener("pointerdown", count("pointer"), { capture: true })
    el.addEventListener("mousedown", count("mouse"), { capture: true })
    el.addEventListener("scroll", count("scroll"), { passive: true })
    el.ownerDocument.addEventListener("pointerdown", block, { capture: true })
    el.ownerDocument.addEventListener("mousedown", block, { capture: true })
  })

  const coords = await list.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const gutter = el.offsetWidth - el.clientWidth
    const thumb = Math.max(20, (el.clientHeight * el.clientHeight) / el.scrollHeight)
    return {
      x: rect.right - gutter / 2,
      y: rect.bottom - thumb / 2 - 2,
      target: Math.max(rect.top + thumb / 2 + 2, rect.bottom - thumb / 2 - 242),
    }
  })

  await page.mouse.move(coords.x, coords.y)
  await page.mouse.down()
  await page.mouse.move(coords.x, coords.target, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => list.evaluate((el) => Number(el.dataset.scroll ?? "0"))).toBeGreaterThan(0)
  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await settle(page, 10)
  const before = await state(page)
  await settle(page, 4)
  const stable = await state(page)
  expect(Math.abs(stable.top - before.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(stable.height - before.height)).toBeLessThanOrEqual(1)
  expect(stable.distance).toBeGreaterThan(40)
  expect(await list.getAttribute("data-pointer")).toBe("0")
  expect(await list.getAttribute("data-mouse")).toBe("0")
  expect(await list.getAttribute("data-scroll")).toMatch(/[1-9]/)
  await expect(scrollButton(page)).toBeVisible()

  await page.getByTestId("append-stream").click()
  await expect.poll(() => list.evaluate((el) => el.scrollHeight)).toBeGreaterThan(stable.height)
  await settle(page, 10)
  const after = await state(page)
  expect(after.top).toBeCloseTo(stable.top, 0)
  expect(after.distance).toBeGreaterThan(40)
  await expect(scrollButton(page)).toBeVisible()

  await scrollButton(page).click()
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)
  await expect(scrollButton(page)).toBeHidden()

  await page.getByTestId("append-stream").click()
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)
  await expect(scrollButton(page)).toBeHidden()
})

test("keeps a long native scrollbar drag user-controlled", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await list.evaluate((el) => {
    const count = () => {
      el.dataset.scroll = String(Number(el.dataset.scroll ?? "0") + 1)
    }
    const block = (event: Event) => {
      if (event.target === el) event.stopPropagation()
    }
    el.dataset.scroll = "0"
    el.addEventListener("scroll", count, { passive: true })
    el.ownerDocument.addEventListener("pointerdown", block, { capture: true })
    el.ownerDocument.addEventListener("mousedown", block, { capture: true })
  })

  const coords = await list.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const gutter = el.offsetWidth - el.clientWidth
    const thumb = Math.max(20, (el.clientHeight * el.clientHeight) / el.scrollHeight)
    return {
      x: rect.right - gutter / 2,
      y: rect.bottom - thumb / 2 - 2,
      target: Math.max(rect.top + thumb / 2 + 2, rect.bottom - thumb / 2 - 242),
    }
  })

  await page.mouse.move(coords.x, coords.y)
  await page.mouse.down()
  await page.mouse.move(coords.x, coords.target, { steps: 18 })
  await page.waitForTimeout(350)
  await page.mouse.up()

  await expect.poll(() => list.evaluate((el) => Number(el.dataset.scroll ?? "0"))).toBeGreaterThan(0)
  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(scrollButton(page)).toBeVisible()
})

test("pauses on an upward wheel over the Copy response button", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  const copy = page.getByRole("button", { name: "Copy response" }).first()
  await expect(list).toBeVisible()
  await expect(copy).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await copy.hover()
  await page.mouse.wheel(0, -240)

  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(scrollButton(page)).toBeVisible()
})

test("keeps a one-pixel upward wheel pause through delayed streaming", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  const copy = page.getByRole("button", { name: "Copy response" }).first()
  await expect(list).toBeVisible()
  await expect(copy).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await copy.hover()
  await page.mouse.wheel(0, -1)
  await expect.poll(() => distance(page)).toBeGreaterThan(0)
  const before = await state(page)

  await page.waitForTimeout(350)
  await page.getByTestId("append-stream").click()

  await expect.poll(() => list.evaluate((el) => el.scrollHeight)).toBeGreaterThan(before.height)
  await settle(page, 10)
  const after = await state(page)
  expect(after.top).toBeCloseTo(before.top, 0)
  expect(after.distance).toBeGreaterThan(40)
  await expect(scrollButton(page)).toBeVisible()
})

test("keeps the pause after a pending bottom scroll event", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  const copy = page.getByRole("button", { name: "Copy response" }).first()
  const bottom = scrollButton(page)
  await expect(list).toBeVisible()
  await expect(copy).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await list.evaluate((el) => {
    const fire = () => {
      el.dataset.pending = "1"
      el.dispatchEvent(new Event("scroll"))
    }
    const wheel = (event: Event) => {
      if (event.target !== el && event.target instanceof Element && !el.contains(event.target)) return
      queueMicrotask(fire)
      el.ownerDocument.removeEventListener("wheel", wheel, true)
    }
    el.dataset.pending = "0"
    el.ownerDocument.addEventListener("wheel", wheel, true)
  })

  await copy.hover()
  await page.mouse.wheel(0, -1)
  await expect.poll(() => list.getAttribute("data-pending")).toBe("1")
  await expect.poll(() => distance(page)).toBeGreaterThan(0)
  await expect(bottom).toBeVisible()
})

for (const input of ["wheel", "keyboard"] as const) {
  test(`keeps new upward ${input} input before a pending return-to-bottom scroll`, async ({ page }) => {
    await open(page)
    const list = page.locator(".message-list")
    const bottom = scrollButton(page)
    await expect(list).toBeVisible()
    await settle(page, 10)
    await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

    await list.hover()
    await page.mouse.wheel(0, -240)
    await expect.poll(() => distance(page)).toBeGreaterThan(40)
    await expect(bottom).toBeVisible()
    await settle(page, 4)

    await list.evaluate((el, input) => {
      if (input === "keyboard") {
        el.tabIndex = 0
        el.focus({ preventScroll: true })
      }
      const type = input === "wheel" ? "wheel" : "keydown"
      const prime = () => {
        el.scrollTop = el.scrollHeight - el.clientHeight
      }
      const pending = () => {
        el.dispatchEvent(new Event("scroll"))
        el.dataset.pending = "1"
      }
      el.ownerDocument.addEventListener(type, prime, { capture: true, passive: false, once: true })
      const target = input === "wheel" ? el : el.ownerDocument
      target.addEventListener(type, pending, { capture: input === "wheel", passive: false, once: true })
    }, input)

    if (input === "wheel") await page.mouse.wheel(0, -20)
    if (input === "keyboard") await page.keyboard.press("ArrowUp")
    await expect.poll(() => list.getAttribute("data-pending")).toBe("1")
    await expect.poll(() => distance(page)).toBeGreaterThan(10)
    await expect(bottom).toBeVisible()
    await settle(page, 20)
    const before = await state(page)

    await page.waitForTimeout(350)
    await page.getByTestId("append-stream").click()
    await expect.poll(() => list.evaluate((el) => el.scrollHeight)).toBeGreaterThan(before.height)
    await settle(page, 10)
    expect((await state(page)).top).toBeCloseTo(before.top, 0)
    await expect(bottom).toBeVisible()
  })
}

test("preserves the pause across working status changes", async ({ page }) => {
  await open(page)
  const list = page.locator(".message-list")
  const bottom = scrollButton(page)
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await list.hover()
  await page.mouse.wheel(0, -240)
  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(bottom).toBeVisible()
  await page.getByTestId("toggle-status").click()
  await page.getByTestId("toggle-status").click()
  await settle(page, 4)

  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(bottom).toBeVisible()
})
