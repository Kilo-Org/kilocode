// kilocode_change - new file
import { BackgroundTaskRuntime } from "./background-task-runtime"
import { SubagentSpawn } from "./subagent-spawn"

export namespace BackgroundSubagentStart {
  export type Input = SubagentSpawn.Input

  export type Result = Awaited<ReturnType<typeof BackgroundTaskRuntime.start>>

  export async function start(input: Input): Promise<Result> {
    const prepared = await SubagentSpawn.prepare(input)

    return BackgroundTaskRuntime.start({
      parentSessionID: input.parentSessionID,
      childSessionID: prepared.childSessionID,
      childUserMessageID: prepared.childUserMessageID,
      launch: prepared.launch,
      completion: prepared.completion,
    })
  }
}
