import { afterEach, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { documentKind } from "@opencode-ai/ui/file-path"
import { ContentPart } from "../src/components/message-part"
import { mountRich, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function message(): SessionMessageAssistant {
  return {
    id: "msg_text_links",
    type: "assistant",
    time: { created: 0, completed: 1 },
    content: [],
  } as unknown as SessionMessageAssistant
}

function part(text: string, validateFiles: (sessionID: string, paths: string[]) => Promise<string[]>) {
  const opened: Array<{ path: string; line?: number; sessionID?: string }> = []
  const card = mountRich(() => (
    <ContentPart
      item={{ type: "text", text }}
      message={message()}
      index={0}
      session="ses_links"
      actions={{
        validateFiles,
        openFile: (path, line, _column, sessionID) => opened.push({ path, line, sessionID }),
      }}
    />
  ))
  mounted.push(card)
  return { card, opened }
}

test("an existing inline file becomes a link and opens for its session", async () => {
  const { card, opened } = part("See `./README.md` for details.", async (_session, paths) =>
    paths.filter((path) => path.endsWith("README.md")),
  )

  const link = await waitFor(() => card.host.querySelector<HTMLElement>("code.file-link[data-file-path]"))

  expect(link.getAttribute("data-file-path")).toBe("README.md")
  expect(link.classList.contains("document-link")).toBe(true)
  expect(card.host.querySelector("code.file-link-candidate")).toBeNull()
  link.click()
  expect(opened).toEqual([{ path: "README.md", line: undefined, sessionID: "ses_links" }])
})

test("a missing inline file stays plain code and never opens", async () => {
  const { card, opened } = part("See `./missing.md` for details.", async () => [])

  const code = await waitFor(() => card.host.querySelector<HTMLElement>("code"))
  await waitFor(() => !code.classList.contains("file-link-candidate"))

  expect(code.classList.contains("file-link")).toBe(false)
  code.click()
  expect(opened).toEqual([])
})

test("a markdown file link opens only after worktree validation", async () => {
  const { card, opened } = part(
    "[README.md](docs/README.md:12) and [secret](../../.env) and [missing](missing.md)",
    async (_session, paths) => paths.filter((path) => path.endsWith("README.md")),
  )

  const links = await waitFor(() => {
    const found = [...card.host.querySelectorAll<HTMLAnchorElement>("a.file-path-link")]
    return found.length === 3 ? found : undefined
  })
  links[0]!.click()
  await waitFor(() => opened.length === 1)
  links[1]!.click()
  links[2]!.click()
  await waitFor(() => !links[2]!.classList.contains("document-link"))

  expect(opened).toEqual([{ path: "docs/README.md", line: 12, sessionID: "ses_links" }])
  expect(links[0]!.classList.contains("document-link")).toBe(true)
  expect(links[1]!.classList.contains("document-link")).toBe(false)
})

test("a file URL link opens although the sanitizer drops its href", async () => {
  const { card, opened } = part("[plan](file:///repo/plan.md#L3)", async (_session, paths) => paths)

  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>("a.file-path-link"))
  // The browser sanitizer drops `file:` hrefs; the test DOM keeps them, so drop it here.
  link.removeAttribute("href")
  link.click()
  await waitFor(() => opened.length === 1)
  link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await waitFor(() => opened.length === 2)

  expect(link.getAttribute("tabindex")).toBe("0")
  expect(link.getAttribute("role")).toBe("link")
  expect(opened).toEqual([
    { path: "/repo/plan.md", line: undefined, sessionID: "ses_links" },
    { path: "/repo/plan.md", line: undefined, sessionID: "ses_links" },
  ])
})

test("a plan document gets the plan glyph class in code and links", async () => {
  const { card } = part("Review `./plan/42-plan.md` or [it](plan/42-plan.md).", async (_session, paths) => paths)

  const code = await waitFor(() => card.host.querySelector<HTMLElement>("code.plan-document-link"))
  const link = card.host.querySelector<HTMLElement>("a.plan-document-link")

  expect(code.getAttribute("data-file-kind")).toBe("plan")
  expect(link?.getAttribute("data-file-kind")).toBe("plan")
})

test("plan detection accepts Windows separators", () => {
  expect(documentKind("plan\\42.md")).toBe("plan")
  expect(documentKind("C:\\Users\\me\\.opencode\\plan\\42.md")).toBe("plan")
  expect(documentKind("docs\\guide.md")).toBe("document")
  expect(documentKind("src\\index.ts")).toBeUndefined()
})
