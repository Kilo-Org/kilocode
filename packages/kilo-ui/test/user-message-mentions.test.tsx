import { afterEach, expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "../src/components/message-part"
import { mountRich, type Mounted } from "./harness"

let mounted: Mounted[] = []

afterEach(() => {
  for (const view of mounted) view.dispose()
  mounted = []
})

const text = "Compare @src/a.ts with @Fix auth bug and @terminal"

const message = {
  id: "msg_1",
  type: "user",
  text,
  time: { created: 1 },
  files: [
    {
      data: "AA==",
      mime: "text/plain",
      name: "src/a.ts",
      source: { type: "uri", uri: "file:///repo/src/a.ts" },
      mention: { text: "@src/a.ts", start: 8, end: 17 },
    },
    {
      data: "AA==",
      mime: "text/plain",
      name: "Fix-auth-bug.md",
      source: { type: "uri", uri: "session:ses_auth" },
      mention: { text: "@Fix auth bug", start: 23, end: 36 },
    },
    {
      data: "AA==",
      mime: "text/plain",
      name: "terminal-output.txt",
      source: { type: "inline" },
      mention: { text: "@terminal", start: 41, end: 50 },
    },
    { data: "AA==", mime: "text/plain", name: "selection.ts:1-2", source: { type: "inline" } },
  ],
} as unknown as SessionMessageUser

test("mentions show inline in the text instead of as attachment chips", () => {
  const view = mountRich(() => <UserMessageDisplay message={message} />)
  mounted.push(view)

  const highlighted = [...view.host.querySelectorAll('[data-slot="user-message-text"] [data-highlight="file"]')]
  expect(highlighted.map((item) => item.textContent)).toEqual(["@src/a.ts", "@Fix auth bug", "@terminal"])
  expect(view.host.querySelector('[data-slot="user-message-text"]')?.textContent).toBe(text)
  // A context chip without a mention keeps its chip; the mention files do not get one.
  const chips = [...view.host.querySelectorAll('[data-slot="user-message-attachment-name"]')]
  expect(chips.map((item) => item.textContent)).toEqual(["selection.ts:1-2"])
})

test("a file mention opens the file and a past chat mention opens the session", () => {
  const opened: string[] = []
  const view = mountRich(() => (
    <UserMessageDisplay
      message={message}
      onOpenFile={(path) => opened.push(`file:${path}`)}
      onOpenSession={(id) => opened.push(`session:${id}`)}
    />
  ))
  mounted.push(view)

  const [file, chat, terminal] = [...view.host.querySelectorAll<HTMLElement>('[data-highlight="file"]')]
  expect(file?.hasAttribute("data-clickable")).toBe(true)
  expect(chat?.hasAttribute("data-clickable")).toBe(true)
  expect(terminal?.hasAttribute("data-clickable")).toBe(false)
  file?.click()
  chat?.click()
  terminal?.click()
  expect(opened).toEqual(["file:src/a.ts", "session:ses_auth"])
})

test("mentions are not clickable without a handler", () => {
  const view = mountRich(() => <UserMessageDisplay message={message} />)
  mounted.push(view)
  expect(view.host.querySelectorAll("[data-clickable]")).toHaveLength(0)
})
