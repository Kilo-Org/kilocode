import { afterEach, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { ContentPart } from "../src/components/message-part"
import type { ValidateFilesFn } from "../src/file-link-validator"
import { mountRich, mountTool, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function message(): SessionMessageAssistant {
  return {
    id: "msg_web_links",
    type: "assistant",
    time: { created: 0, completed: 1 },
    content: [],
  } as unknown as SessionMessageAssistant
}

function part(
  text: string,
  open: (url: string, external?: boolean) => void,
  validateFiles: ValidateFilesFn = async () => [],
) {
  const card = mountRich(() => (
    <ContentPart
      item={{ type: "text", text }}
      message={message()}
      index={0}
      session="ses_links"
      open={open}
      actions={{ validateFiles, openFile: () => undefined }}
    />
  ))
  mounted.push(card)
  return card
}

// VS Code's webview window handler opens every anchor externally. A click the chat claims must not reach it.
async function windowClicks(click: () => void) {
  let clicks = 0
  const handler = () => clicks++
  window.addEventListener("click", handler)
  try {
    click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    window.removeEventListener("click", handler)
  }
  return clicks
}

test("a web link opens in the Integrated Browser route only", async () => {
  const opened: Array<{ url: string; external?: boolean }> = []
  const card = part("[Kilo](https://kilo.ai/docs)", (url, external) => opened.push({ url, external }))

  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>("a[href]"))
  const seen = await windowClicks(() => link.click())

  expect(opened).toEqual([{ url: "https://kilo.ai/docs", external: false }])
  expect(seen).toBe(0)
})

test("shift-click asks for the system browser without a second external open", async () => {
  const opened: Array<{ url: string; external?: boolean }> = []
  const card = part("[Kilo](https://kilo.ai/files)", (url, external) => opened.push({ url, external }))

  // The event must be cancelable: a real click is, and `preventDefault()` is a no-op on a non-cancelable one, in
  // which case the DOM follows the href and navigates the test window to the live site.
  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>("a[href]"))
  const seen = await windowClicks(() =>
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true, cancelable: true })),
  )

  expect(opened).toEqual([{ url: "https://kilo.ai/files", external: true }])
  expect(seen).toBe(0)
})

test("a file link is claimed even when its href would open externally", async () => {
  const card = part(
    "[README.md](README.md)",
    () => undefined,
    async (_session, paths) => paths,
  )

  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>("a.file-path-link"))
  const seen = await windowClicks(() => link.click())

  expect(seen).toBe(0)
})

test("a web search result link is claimed from the window handler", async () => {
  const opened: string[] = []
  const card = mountTool("websearch", {
    input: { query: "kilo" },
    output: "See https://kilo.ai/docs for details.",
    openUrl: (url) => opened.push(url),
    forceOpen: true,
  })
  mounted.push(card)

  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>('[data-slot="exa-tool-link"]'))
  const seen = await windowClicks(() => link.click())

  expect(opened).toEqual(["https://kilo.ai/docs"])
  expect(seen).toBe(0)
})
