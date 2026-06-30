import { BackgroundProcess } from "@/kilocode/background-process"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"

export namespace KiloTaskBackgroundProcess {
  export function finish(sessionID: SessionID) {
    return Effect.promise(() => BackgroundProcess.stopSession(sessionID)).pipe(Effect.ignore)
  }
}
