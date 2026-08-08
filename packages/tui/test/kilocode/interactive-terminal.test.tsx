/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { Show } from "solid-js"
import type { InteractiveTerminalSnapshot, Session } from "@kilocode/sdk/v2"
import { testRender } from "@opentui/solid"
import path from "node:path"
import { ArgsProvider } from "../../src/context/args"
import { ExitProvider } from "../../src/context/exit"
import { KVProvider } from "../../src/context/kv"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider, useSync } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TerminalPrompt } from "../../src/routes/session/terminal"
import { ToastProvider } from "../../src/ui/toast"
import { createFetch, directory, eventSource, json } from "../fixture/tui-sdk"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const session: Session = {
  id: "ses_terminal",
  slug: "terminal",
  projectID: "proj_test",
  workspaceID: "ws_terminal",
  directory,
  title: "Terminal",
  version: "7.4.20",
  time: { created: 1, updated: 1 },
}

const snapshot: InteractiveTerminalSnapshot = {
  info: {
    id: "itx_terminal",
    sessionID: session.id,
    pid: 123,
    command: "prompt",
    cwd: directory,
    status: "running",
    cols: 80,
    rows: 14,
    time: { started: 1, updated: 1 },
  },
  output: "READY",
  cursor: 5,
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for terminal request")
    await Bun.sleep(10)
  }
}

test("routes interactive terminal input through the session workspace", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "kv.json"), "{}")
  const seen: URL[] = []
  const calls = createFetch((url) => {
    seen.push(url)
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/interactive-terminal") return json([snapshot])
    if (url.pathname === "/interactive-terminal/itx_terminal") return json(snapshot)
    if (url.pathname.startsWith("/interactive-terminal/itx_terminal/")) return json(true)
    return undefined
  })
  const config = createTuiResolvedConfig()
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: tmp.path }}>
      <ArgsProvider>
        <KVProvider>
          <TuiConfigProvider config={config}>
            <ToastProvider>
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={eventSource()}>
                <PermissionProvider>
                  <ProjectProvider>
                    <ExitProvider exit={() => {}}>
                      <SyncProvider>
                        <Ready />
                      </SyncProvider>
                    </ExitProvider>
                  </ProjectProvider>
                </PermissionProvider>
              </SDKProvider>
            </ToastProvider>
          </TuiConfigProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => seen.some((url) => url.pathname === "/interactive-terminal/itx_terminal"))
    app.mockInput.pressKey("x")
    await wait(() => seen.some((url) => url.pathname === "/interactive-terminal/itx_terminal/input"))

    const terminal = seen.filter((url) => url.pathname.startsWith("/interactive-terminal/itx_terminal"))
    expect(terminal.length).toBeGreaterThan(0)
    expect(terminal.every((url) => url.searchParams.get("workspace") === session.workspaceID)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

function Ready() {
  const sync = useSync()
  return (
    <Show when={sync.status === "complete"}>
      <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
        <TerminalPrompt sessionID={session.id} terminalID={snapshot.info.id} />
      </ThemeProvider>
    </Show>
  )
}
