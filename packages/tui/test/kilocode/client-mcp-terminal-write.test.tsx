/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, onCleanup, Show } from "solid-js"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { useSessionTerminals, SessionTerminalsProvider } from "../../src/context/session-terminals"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createApi, createEventStream, createFetch, directory } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

test("terminal writes fail after the input writer detaches", async () => {
  await using state = await tmpdir()
  const events = createEventStream()
  const input: Uint8Array[] = []
  const fetch = createFetch(undefined, events)
  const [attached, setAttached] = createSignal(true)
  let terminals!: ReturnType<typeof useSessionTerminals>
  function Writer() {
    onCleanup(terminals.attachWriter("pty_fixture", (data) => input.push(data)))
    return null
  }
  function Probe() {
    terminals = useSessionTerminals()
    return (
      <Show when={attached()}>
        <Writer />
      </Show>
    )
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: state.path }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ClientProvider api={createApi(fetch.fetch)}>
            <DataProvider directory={directory}>
              <SessionTerminalsProvider>
                <Probe />
              </SessionTerminalsProvider>
            </DataProvider>
          </ClientProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))
  expect(terminals.write("pty_fixture", new TextEncoder().encode("before"))).toBe(true)
  expect(input).toHaveLength(1)
  setAttached(false)
  expect(terminals.write("pty_fixture", new TextEncoder().encode("after"))).toBe(false)
  expect(input).toHaveLength(1)
  setAttached(true)
  expect(input).toHaveLength(1)
  app.renderer.destroy()
  events.disconnect()
})
