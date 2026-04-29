import type { Message, Session, Part, SnapshotFileDiff, SessionStatus, ProviderListResponse } from "@kilocode/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: ProviderListResponse
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

// kilocode_change start
export type OpenFileFn = (filePath: string, line?: number, column?: number) => void

export type OpenDiffFn = (diff: {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}) => void

export type OpenUrlFn = (url: string) => void
// kilocode_change end

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    // kilocode_change start
    onOpenFile?: OpenFileFn
    onOpenDiff?: OpenDiffFn
    onOpenUrl?: OpenUrlFn
    // kilocode_change end
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      // kilocode_change start
      openFile: props.onOpenFile,
      openDiff: props.onOpenDiff,
      openUrl: props.onOpenUrl,
      // kilocode_change end
    }
  },
})
