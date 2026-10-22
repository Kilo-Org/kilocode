import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as AnacondaDesktop from "@/kilocode/anaconda-desktop/service"
import { NotReadyError, PlatformError, SyncError, ToolAcknowledgementError } from "@/kilocode/anaconda-desktop/domain"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { AnacondaDesktopConflictError, AnacondaDesktopOperationError } from "../groups/anaconda-desktop"

function openError(error: PlatformError) {
  if (error.reason === "unsupported") {
    return new AnacondaDesktopConflictError({
      code: "unsupported-platform",
      message: "Anaconda Desktop is not supported on this platform.",
    })
  }
  if (error.reason === "not-installed") {
    return new AnacondaDesktopConflictError({
      code: "not-installed",
      message: "Anaconda Desktop is not installed.",
    })
  }
  return new AnacondaDesktopOperationError({
    operation: "open",
    message: "Anaconda Desktop could not be opened.",
  })
}

function syncError(error: NotReadyError | SyncError | ToolAcknowledgementError) {
  if (error instanceof NotReadyError) {
    return new AnacondaDesktopConflictError({
      code: "not-ready",
      message: "Anaconda Desktop does not have a healthy text-generation server ready.",
      status: error.status,
    })
  }
  if (error instanceof ToolAcknowledgementError) {
    return new AnacondaDesktopConflictError({
      code: "acknowledgement-required",
      message: "Acknowledge limited tool support before connecting this model server.",
      status: error.status,
    })
  }
  return new AnacondaDesktopOperationError({
    operation: "sync",
    message: "The Anaconda Desktop connection could not be stored.",
  })
}

export const anacondaDesktopHandlers = HttpApiBuilder.group(InstanceHttpApi, "anaconda-desktop", (handlers) =>
  Effect.gen(function* () {
    const desktop = yield* AnacondaDesktop.Service

    return handlers
      .handle("status", () => desktop.status())
      .handle("open", () => desktop.open().pipe(Effect.mapError(openError)))
      .handle("sync", (ctx) =>
        desktop.sync(ctx.payload.acknowledgeToolLimitations === true).pipe(Effect.mapError(syncError)),
      )
  }),
)
