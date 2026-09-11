// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import type { QuestionRequest } from "@kilocode/sdk/v2"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createEventSource } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 5000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function request(): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Which format?",
        header: "Format",
        options: [{ label: "json", description: "JSON output" }],
      },
    ],
  }
}

async function mount(input: { root: string; requests: { path: string; body: unknown }[] }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const events = createEventSource()
  const fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : String(request))
    const raw = request instanceof Request ? await request.clone().text() : await new Response(init?.body).text()
    input.requests.push({ path: url.pathname, body: raw ? JSON.parse(raw) : undefined })
    return new Response(JSON.stringify(true), { headers: { "content-type": "application/json" } })
  }) as typeof globalThis.fetch

  const [
    { QuestionPrompt },
    { SDKProvider },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap, getOpencodeModeStack },
  ] = await Promise.all([
    import("../../../src/routes/session/question"),
    import("../../../src/context/sdk"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/keymap"),
  ])

  const config = createTuiResolvedConfig()
  const refs: { keymap?: ReturnType<typeof createDefaultOpenTuiKeymap> } = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    refs.keymap = keymap
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <SDKProvider url="http://test" directory={input.root} fetch={fetch} events={events.source}>
                  <box width={80} height={20}>
                    <QuestionPrompt request={request()} />
                  </box>
                </SDKProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  return {
    app,
    pushAutocompleteMode() {
      if (!refs.keymap) throw new Error("keymap not ready")
      return getOpencodeModeStack(refs.keymap).push("autocomplete")
    },
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

async function openCustomEditor(prompt: Awaited<ReturnType<typeof mount>>) {
  // The provider tree mounts the prompt asynchronously, so render until the options are on screen.
  await wait(async () => {
    await prompt.app.renderOnce()
    return prompt.app.captureCharFrame().includes("Type your own answer")
  })
  await prompt.app.flush()
  prompt.app.mockInput.pressArrow("down")
  await prompt.app.flush()
  prompt.app.mockInput.pressEnter()
  await prompt.app.flush()
  await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
}

test("custom answer submits with enter while the textarea is focused", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const prompt = await mount({ root: tmp.path, requests })

  try {
    await openCustomEditor(prompt)

    await prompt.app.mockInput.typeText("markdown")
    await prompt.app.flush()
    prompt.app.mockInput.pressEnter()
    await prompt.app.flush()
    await Bun.sleep(50)

    const reply = requests.find((item) => item.path === "/question/question-1/reply")
    expect(reply).toBeDefined()
    expect((reply?.body as { answers?: string[][] })?.answers).toEqual([["markdown"]])
  } finally {
    await prompt.cleanup()
  }
})

test("custom answer submits with enter while the prompt autocomplete mode is active", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const prompt = await mount({ root: tmp.path, requests })

  try {
    await openCustomEditor(prompt)

    const pop = prompt.pushAutocompleteMode()
    await prompt.app.mockInput.typeText("markdown")
    await prompt.app.flush()
    prompt.app.mockInput.pressEnter()
    await prompt.app.flush()
    await Bun.sleep(50)
    pop()

    const reply = requests.find((item) => item.path === "/question/question-1/reply")
    expect(reply).toBeDefined()
    expect((reply?.body as { answers?: string[][] })?.answers).toEqual([["markdown"]])
  } finally {
    await prompt.cleanup()
  }
})

test("escape cancels the custom answer edit while the prompt autocomplete mode is active", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const prompt = await mount({ root: tmp.path, requests })

  try {
    await openCustomEditor(prompt)

    const pop = prompt.pushAutocompleteMode()
    prompt.app.mockInput.pressEscape()
    await prompt.app.flush()
    await Bun.sleep(50)
    pop()

    expect(requests.find((item) => item.path === "/question/question-1/reject")).toBeUndefined()
    expect(prompt.app.renderer.currentFocusedEditor).not.toBeInstanceOf(TextareaRenderable)
  } finally {
    await prompt.cleanup()
  }
})

test("escape cancels the custom answer edit", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const prompt = await mount({ root: tmp.path, requests })

  try {
    await openCustomEditor(prompt)

    prompt.app.mockInput.pressEscape()
    await prompt.app.flush()
    expect(requests.find((item) => item.path === "/question/question-1/reject")).toBeUndefined()

    prompt.app.mockInput.pressEscape()
    await prompt.app.flush()
    expect(requests.find((item) => item.path === "/question/question-1/reject")).toBeDefined()
  } finally {
    await prompt.cleanup()
  }
})
