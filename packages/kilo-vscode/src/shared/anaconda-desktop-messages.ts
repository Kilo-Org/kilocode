import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2/client"

export type AnacondaDesktopAction = "status" | "open" | "sync"

export type AnacondaDesktopWebviewMessage =
  | { type: "anacondaDesktopStatus"; requestId: string }
  | { type: "anacondaDesktopOpen"; requestId: string }
  | {
      type: "anacondaDesktopSync"
      requestId: string
      acknowledgeToolLimitations: boolean
    }
  | { type: "cancelAnacondaDesktopRequest"; requestId: string }

export type AnacondaDesktopExtensionMessage =
  | {
      type: "anacondaDesktopStatusResult"
      requestId: string
      status: AnacondaDesktopStatus
    }
  | { type: "anacondaDesktopOpened"; requestId: string }
  | {
      type: "anacondaDesktopSynced"
      requestId: string
      status: Extract<AnacondaDesktopStatus, { type: "ready" }>
    }
  | {
      type: "anacondaDesktopActionError"
      requestId: string
      action: AnacondaDesktopAction
      message: string
    }

export type AnacondaDesktopRequest = Exclude<AnacondaDesktopWebviewMessage, { type: "cancelAnacondaDesktopRequest" }>
export type AnacondaDesktopResult = Exclude<AnacondaDesktopExtensionMessage, { type: "anacondaDesktopActionError" }>
export type AnacondaDesktopError = Extract<AnacondaDesktopExtensionMessage, { type: "anacondaDesktopActionError" }>
