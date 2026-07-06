import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { fileURLToPath } from "node:url"

const source = fileURLToPath(new URL("../../ui/src/kilocode/markdown-incremental-dom.ts", import.meta.url))
const bundle = await build({
  stdin: {
    contents: `
      import { createIncrementalMarkdown } from ${JSON.stringify(source)}
      globalThis.createIncrementalMarkdown = createIncrementalMarkdown
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
})
const script = bundle.outputFiles[0]!.text

test.beforeEach(async ({ page }) => {
  await page.goto("about:blank")
  await page.addScriptTag({ content: script })
})

test("keeps completed Markdown nodes while replacing only the live tail", async ({ page }) => {
  const result = await page.evaluate(() => {
    const create = (
      globalThis as typeof globalThis & {
        createIncrementalMarkdown: (decorate: () => void) => {
          update: (
            container: HTMLDivElement,
            blocks: Array<{ key: string; hash: string; html: string; mode: "full" | "live" }>,
            labels: { copy: string; copied: string },
          ) => boolean
        }
      }
    ).createIncrementalMarkdown
    const labels = { copy: "Copy", copied: "Copied" }
    const container = document.createElement("div")
    document.body.append(container)
    const renderer = create(() => {})
    const heading = { key: "0", hash: "heading", html: "<h2>Heading</h2>", mode: "full" as const }
    const tail = { key: "1", hash: "tail-a", html: "<p>Tail A</p>", mode: "live" as const }

    renderer.update(container, [heading, tail], labels)
    const stable = container.children[0]
    const previous = container.children[1]
    renderer.update(container, [heading, { ...tail, hash: "tail-b", html: "<p>Tail B</p>" }], labels)

    return {
      stable: container.children[0] === stable,
      replaced: container.children[1] !== previous,
      tags: Array.from(container.children).map((child) => child.tagName),
      text: container.textContent,
    }
  })

  expect(result).toEqual({ stable: true, replaced: true, tags: ["H2", "P"], text: "HeadingTail B" })
})

test("promotes an unchanged tail and appends the next block without wrappers", async ({ page }) => {
  const result = await page.evaluate(() => {
    const create = (
      globalThis as typeof globalThis & {
        createIncrementalMarkdown: (decorate: () => void) => {
          update: (
            container: HTMLDivElement,
            blocks: Array<{ key: string; hash: string; html: string; mode: "full" | "live" }>,
            labels: { copy: string; copied: string },
          ) => boolean
        }
      }
    ).createIncrementalMarkdown
    const labels = { copy: "Copy", copied: "Copied" }
    const container = document.createElement("div")
    document.body.append(container)
    const renderer = create(() => {})
    const heading = { key: "0", hash: "heading", html: "<h2>Heading</h2>", mode: "full" as const }
    const paragraph = { key: "1", hash: "paragraph", html: "<p>Stable</p>", mode: "live" as const }

    renderer.update(container, [heading, paragraph], labels)
    const stable = container.children[1]
    renderer.update(
      container,
      [
        heading,
        { ...paragraph, mode: "full" },
        { key: "2", hash: "tail", html: "<ul><li>Next</li></ul>", mode: "live" as const },
      ],
      labels,
    )

    return {
      stable: container.children[1] === stable,
      tags: Array.from(container.children).map((child) => child.tagName),
    }
  })

  expect(result).toEqual({ stable: true, tags: ["H2", "P", "UL"] })
})

test("runs streaming hooks only when incremental rendering handles the update", async ({ page }) => {
  const result = await page.evaluate(() => {
    const create = (
      globalThis as typeof globalThis & {
        createIncrementalMarkdown: (
          decorate: () => void,
          hooks: {
            cancel: () => void
            ready: (container: HTMLDivElement, labels: { copy: string; copied: string }, context: string) => void
          },
        ) => {
          render: (
            streaming: boolean,
            container: HTMLDivElement,
            blocks: Array<{ key: string; hash: string; html: string; mode: "full" | "live" }>,
            labels: { copy: string; copied: string },
            context: string,
          ) => boolean
        }
      }
    ).createIncrementalMarkdown
    const labels = { copy: "Copy", copied: "Copied" }
    const container = document.createElement("div")
    document.body.append(container)
    const calls: string[] = []
    const renderer = create(() => {}, {
      cancel: () => calls.push("cancel"),
      ready: (_container, _labels, context) => calls.push(context),
    })
    const stable = { key: "0", hash: "stable", html: "<p>Stable</p>", mode: "full" as const }
    const tail = { key: "1", hash: "tail", html: "<p>Tail</p>", mode: "live" as const }

    const completed = renderer.render(false, container, [stable, tail], labels, "ready")
    const unsupported = renderer.render(true, container, [tail], labels, "unsupported")
    const streaming = renderer.render(true, container, [stable, tail], labels, "ready")
    return { calls, completed, streaming, unsupported }
  })

  expect(result).toEqual({ calls: ["cancel", "ready"], completed: false, streaming: true, unsupported: false })
})

test("falls back when there is no stable prefix", async ({ page }) => {
  const result = await page.evaluate(() => {
    const create = (
      globalThis as typeof globalThis & {
        createIncrementalMarkdown: (decorate: () => void) => {
          update: (
            container: HTMLDivElement,
            blocks: Array<{ key: string; hash: string; html: string; mode: "full" | "live" }>,
            labels: { copy: string; copied: string },
          ) => boolean
        }
      }
    ).createIncrementalMarkdown
    const labels = { copy: "Copy", copied: "Copied" }
    const container = document.createElement("div")
    const renderer = create(() => {})
    const first = { key: "0", hash: "first", html: "<p>First</p>", mode: "live" as const }
    const second = { key: "1", hash: "second", html: "<p>Second</p>", mode: "live" as const }

    return {
      multiple: renderer.update(container, [first, second], labels),
      single: renderer.update(container, [first], labels),
    }
  })

  expect(result).toEqual({ multiple: false, single: false })
})

test("rebuilds safely when a Markdown boundary disappears", async ({ page }) => {
  const result = await page.evaluate(() => {
    const create = (
      globalThis as typeof globalThis & {
        createIncrementalMarkdown: (decorate: () => void) => {
          update: (
            container: HTMLDivElement,
            blocks: Array<{ key: string; hash: string; html: string; mode: "full" | "live" }>,
            labels: { copy: string; copied: string },
          ) => boolean
        }
      }
    ).createIncrementalMarkdown
    const labels = { copy: "Copy", copied: "Copied" }
    const container = document.createElement("div")
    document.body.append(container)
    const renderer = create(() => {})
    const blocks = [
      { key: "0", hash: "stable", html: "<p>Stable</p>", mode: "full" as const },
      { key: "1", hash: "middle", html: "<p>Middle</p>", mode: "full" as const },
      { key: "2", hash: "tail", html: "<p>Tail</p>", mode: "live" as const },
    ]

    renderer.update(container, blocks, labels)
    const comments = Array.from(container.childNodes).filter((node) => node.nodeType === Node.COMMENT_NODE)
    comments.at(-1)?.remove()
    const updated = renderer.update(container, [blocks[0]!, { ...blocks[1]!, mode: "live" }], labels)

    return {
      updated,
      tags: Array.from(container.children).map((child) => child.tagName),
      text: container.textContent,
    }
  })

  expect(result).toEqual({ updated: true, tags: ["P", "P"], text: "StableMiddle" })
})
