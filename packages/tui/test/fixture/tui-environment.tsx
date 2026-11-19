/** @jsxImportSource @opentui/solid */
import {
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  type TuiPaths,
} from "../../src/context/runtime"
import type { ParentProps } from "solid-js"
import { LogProvider, type LogSink } from "../../src/context/log"
import { ClipboardProvider, type ClipboardService } from "../../src/context/clipboard"
import { ConfigProvider } from "../../src/config" // kilocode_change - the default config below
import { createTuiResolvedConfig } from "./tui-runtime" // kilocode_change

const clipboard: ClipboardService = {
  async read() {
    return undefined
  },
  async write() {},
}

export function TestTuiContexts(
  props: ParentProps<{
    cwd?: string
    directory?: string
    paths?: Partial<TuiPaths>
    log?: LogSink
    clipboard?: ClipboardService
  }>,
) {
  return (
    <LogProvider log={props.log ?? (() => {})}>
      <TuiPathsProvider
        value={{
          cwd: props.cwd ?? props.directory ?? "/tmp/opencode/packages/tui",
          home: "/tmp/opencode/home",
          state: "/tmp/opencode/state",
          worktree: "/tmp/opencode",
          ...props.paths,
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: false }}>
            {/* kilocode_change start - upstream DataProvider needs a config context that Kilo fixtures mount without */}
            <ClipboardProvider value={props.clipboard ?? clipboard}>
              <ConfigProvider config={createTuiResolvedConfig()}>{props.children}</ConfigProvider>
            </ClipboardProvider>
            {/* kilocode_change end */}
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    </LogProvider>
  )
}
