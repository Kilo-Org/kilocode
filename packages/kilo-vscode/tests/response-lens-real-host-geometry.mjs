import assert from "node:assert/strict"
import path from "node:path"
import { writeFile, readFile, lstat } from "node:fs/promises"

export async function settledPopover(editor, expect, page, run, name) {
  const settled = await editor.evaluate(async (element) => {
    const root = element.closest('[data-component="popover-content"]') || element
    const names = []
    const waiting = async () => {
      // A rendering frame starts any CSS transition scheduled by the open state.
      await new Promise(requestAnimationFrame)
      for (;;) {
        const animations = root
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.playState !== "finished" &&
              animation.playState !== "idle" &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
        if (!animations.length) break
        names.push(
          ...animations.map((animation) => animation.animationName || animation.transitionProperty || "web-animation"),
        )
        await Promise.all(
          animations.map((animation) =>
            animation.finished.catch((error) => {
              if (error.name !== "AbortError") throw error
            }),
          ),
        )
      }
      return {
        animationNames: names,
        opacity: getComputedStyle(root).opacity,
        transform: getComputedStyle(root).transform,
        connected: root.isConnected,
        activeAnimations: root.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running")
          .length,
      }
    }
    const expired = Promise.withResolvers()
    const timeout = setTimeout(
      () => expired.reject(new Error("Popover animation did not finish in five seconds")),
      5000,
    )
    try {
      return await Promise.race([waiting(), expired.promise])
    } finally {
      clearTimeout(timeout)
    }
  })
  assert.ok(settled.connected)
  assert.equal(Number(settled.opacity), 1, "Popover screenshot would capture a partially transparent transition")
  await expect(editor).toBeVisible()
  run.visuals ??= {}
  run.visuals[name] = settled
  await writeFile(path.join(run.root, `${name}-animation.json`), JSON.stringify(settled, null, 2))
  await page.screenshot({ path: path.join(run.root, `${name}.png`) })
}

export async function measureBadge(frame, expect, page, run) {
  const badge = frame.getByRole("button", { name: "Annotation #1", exact: true })
  await expect(badge).toBeVisible()
  const geometry = await badge.evaluate((element) => {
    const cluster = element.closest(".annotation-marker-cluster")
    if (!cluster) throw new Error("Source badge has no real marker cluster")
    const measure = (node) => {
      const css = getComputedStyle(node)
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        offsetHeight: node.offsetHeight,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        offsetWidth: node.offsetWidth,
        rect: node.getBoundingClientRect().toJSON(),
        height: css.height,
        minHeight: css.minHeight,
        maxHeight: css.maxHeight,
        boxSizing: css.boxSizing,
        overflowY: css.overflowY,
        paddingTop: css.paddingTop,
        paddingBottom: css.paddingBottom,
        borderTop: css.borderTopWidth,
        borderBottom: css.borderBottomWidth,
        fontSize: css.fontSize,
        lineHeight: css.lineHeight,
        scrollbarWidth: css.scrollbarWidth,
        inlineStyle: node.getAttribute("style"),
      }
    }
    return {
      devicePixelRatio,
      number: element.textContent,
      count: cluster.querySelectorAll(".annotation-marker-badge").length,
      cluster: measure(cluster),
      badge: measure(element),
    }
  })
  assert.equal(geometry.count, 1, "Geometry check requires a single source badge")
  geometry.unnecessaryVerticalOverflow = geometry.cluster.scrollHeight > geometry.cluster.clientHeight + 1
  run.visuals ??= {}
  run.visuals.singleBadge = geometry
  await writeFile(path.join(run.root, "single-badge-geometry.json"), JSON.stringify(geometry, null, 2))
  await page.screenshot({ path: path.join(run.root, "single-badge-context.png") })
  await frame
    .locator(".annotation-marker-cluster")
    .filter({ has: badge })
    .screenshot({ path: path.join(run.root, "single-badge.png") })
  return geometry
}

export async function localOnly(run, sessionID) {
  assert.match(sessionID, /^ses_/)
  const statefile = path.join(run.dirs.workspace, ".kilo", "agent-manager.json")
  const state = JSON.parse(await readFile(statefile, "utf8"))
  const worktrees = Object.values(state.worktrees || {})
  assert.equal(worktrees.length, 0, "LOCAL smoke unexpectedly persisted a worktree")
  const folder = await lstat(path.join(run.dirs.workspace, ".kilo", "worktrees")).catch((error) => {
    if (error.code !== "ENOENT") throw error
  })
  assert.equal(folder, undefined, "LOCAL smoke unexpectedly created a worktrees directory")
  return { mode: "LOCAL", sessionID, statefile, worktrees: 0 }
}
