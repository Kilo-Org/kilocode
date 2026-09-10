import type { Message, Session, Part, SnapshotFileDiff, SessionStatus, Provider } from "@kilocode/client/ide-types"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type NormalizedProviderListResponse = {
  all: Map<string, Provider>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: NormalizedProviderListResponse
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
  part_text_accum_delta?: {
    [partID: string]: string
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string


export type OpenFileFn = (filePath: string, line?: number, column?: number) => void

export type OpenDiffFn = (diff: {
  file: string
  before?: string // optional, kilo uses `patch`
  after?: string // optional, kilo uses `patch`
  patch?: string
  additions: number
  deletions: number
}) => void

export type OpenUrlFn = (url: string) => void

export type OpenContentFn = (content: string, language?: string) => void

export type ValidateFilesFn = (paths: string[]) => Promise<string[]>


export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onOpenFile?: OpenFileFn
    onOpenDiff?: OpenDiffFn
    onOpenUrl?: OpenUrlFn
    onOpenContent?: OpenContentFn
    onValidateFiles?: ValidateFilesFn
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
      openFile: props.onOpenFile,
      openDiff: props.onOpenDiff,
      openUrl: props.onOpenUrl,
      openContent: props.onOpenContent,
      validateFiles: props.onValidateFiles,
    }
  },
})
