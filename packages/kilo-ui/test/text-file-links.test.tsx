import { afterEach, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
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

test("a plan document gets the document glyph class", async () => {
  const { card } = part("Review `./plan/42-plan.md`.", async (_session, paths) => paths)

  const link = await waitFor(() => card.host.querySelector<HTMLElement>("code.plan-document-link"))

  expect(link.getAttribute("data-file-kind")).toBe("plan")
})
