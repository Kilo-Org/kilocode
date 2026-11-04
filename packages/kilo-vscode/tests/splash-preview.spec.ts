import { expect, test, type Page } from "@playwright/test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { examples } =
  require("../webview-ui/agent-manager/splash/examples") as typeof import("../webview-ui/agent-manager/splash/examples")
const { rowId } =
  require("../webview-ui/agent-manager/splash/fleet") as typeof import("../webview-ui/agent-manager/splash/fleet")

const stories = ["cross-stack", "delegate", "compare", "beyond-code"]

async function open(page: Page, story: string) {
  await page.setViewportSize({ width: 1010, height: 1400 })
  await page.addInitScript(() => {
    const posted: unknown[] = []
    Object.defineProperty(window, "posted", { value: posted })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        postMessage: (message: unknown) => posted.push(message),
        getState: () => {},
        setState: () => {},
      }),
    })
  })
  await page.goto(`/iframe.html?id=agentmanager--splash-${story}-story-1280&viewMode=story`)
  await expect(page.locator(".am-splash-preview-fleet-active .am-project-item").first()).toBeVisible()
}

for (const [index, example] of examples.entries()) {
  test(`${example.id} preview renders the real sidebar, inert, with a badge in each feature's row`, async ({
    page,
  }) => {
    await open(page, stories[index]!)
    await expect(page.locator(".am-splash-preview-fleet")).toHaveCount(4)
    expect(
      await page.locator(".am-splash-preview-fleet").evaluateAll((nodes) =>
        nodes.map((node) => ({
          inert: node.hasAttribute("inert"),
          hidden: node.getAttribute("aria-hidden"),
          visibility: getComputedStyle(node).visibility,
        })),
      ),
    ).toEqual(
      examples.map((_, position) => ({
        inert: true,
        hidden: "true",
        visibility: position === index ? "visible" : "hidden",
      })),
    )
    const fleet = page.locator(".am-splash-preview-fleet-active")
    await expect(fleet).toHaveAttribute("inert", "")
    await expect(fleet).toHaveAttribute("aria-hidden", "true")
    await expect(page.locator(".am-splash-preview-card")).toHaveAttribute("role", "figure")
    await expect(fleet.locator(".am-projects")).toHaveCount(1)
    await expect(fleet.locator(".am-project-item")).toHaveCount(example.fixture.projects.length)
    await expect(fleet.locator(".am-splash-row-marker")).toHaveCount(3)

    // Each badge sits inside its feature's row and is vertically centred on it.
    const targets = example.features.map((feature) => {
      const project = example.fixture.projects.find((item) => item.id === feature.row.project)!
      const sections = project.rows.flatMap((row) => (row.kind === "section" ? [row.section] : []))
      const label = (() => {
        if (feature.row.kind === "project") return project.name
        if (feature.row.kind === "section") {
          const id = feature.row.section
          return sections.find((item) => item.id === id)!.name
        }
        return ""
      })()
      // Project sidebars key their rows by project and worktree id.
      const id = `${rowId(example, { kind: "project", project: project.id })}:${rowId(example, feature.row)}`
      return { kind: feature.row.kind, id, label }
    })
    const placed = await fleet.locator(".am-splash-row-marker").evaluateAll(
      (badges, targets) =>
        targets.map((target, index) => {
          // Badges follow sidebar order, so find each by its number.
          const badge = badges.find((item) => item.textContent === String(index + 1))!
          const selector = {
            project: ".am-project-item",
            section: ".am-section-group-header",
            group: ".am-wt-group-header",
            session: ".am-worktree-item",
          }[target.kind]
          const row = badge.closest(selector)
          if (!row) return `badge ${index + 1} is not in a ${target.kind} row`
          if (target.kind === "session" && row.getAttribute("data-sidebar-id") !== target.id)
            return `badge ${index + 1} is in ${row.getAttribute("data-sidebar-id")}`
          if (target.label && !row.textContent?.toUpperCase().includes(target.label.toUpperCase()))
            return `badge ${index + 1} is in ${row.textContent}`
          const box = badge.getBoundingClientRect()
          const rect = row.getBoundingClientRect()
          const center = box.top + box.height / 2
          if (center < rect.top || center > rect.bottom || box.left < rect.left || box.right > rect.right + 1)
            return `badge ${index + 1} is outside its row`
          return "ok"
        }),
      targets,
    )
    expect(placed).toEqual(["ok", "ok", "ok"])

    // Inert rows are skipped by hit testing, so a click lands on the card and posts nothing.
    const row = fleet.locator(".am-worktree-item").first()
    const hit = await row.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.className ?? ""
    })
    expect(hit).toBe("am-splash-preview-card")
    const before = await page.evaluate(() => (Reflect.get(window, "posted") as unknown[]).length)
    await row.click({ force: true })
    await row.dblclick({ force: true })
    expect(await page.evaluate(() => (Reflect.get(window, "posted") as unknown[]).length)).toBe(before)
    expect(await page.evaluate(() => document.activeElement?.closest(".am-splash-preview-card") ?? null)).toBeNull()
  })
}
