import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { WorkspaceManager } from "./workspace/manager"
import { renderPrompt } from "./agent/prompt"
import { SymphonyEvent } from "./events"
import { SymphonyDispatchError } from "./errors"
import type { SymphonyConfig } from "./config/schema"
import type { TrackerIssue } from "./tracker/types"
import type { RunningEntry } from "./types"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "symphony.worker" })

export interface WorkerHandle {
  issueId: string
  identifier: string
  sessionId: string
  stop(): Promise<void>
  getStatus(): RunningEntry
}

export async function startWorker(
  issue: TrackerIssue,
  config: SymphonyConfig,
  promptTemplate: string,
  attempt: number | null,
): Promise<WorkerHandle> {
  const startedAt = Date.now()
  let lastEventAt = startedAt
  let turnCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let stopped = false

  try {
    const workspace = await WorkspaceManager.prepare(issue, config)
    const rendered = renderPrompt(promptTemplate, { issue, attempt })

    const session = await Session.createNext({
      title: `Symphony: ${issue.identifier} - ${issue.title}`,
      directory: workspace.path,
    })
    const sessionId = session.id

    Bus.publish(SymphonyEvent.WorkerStarted, {
      issueId: issue.id,
      identifier: issue.identifier,
      sessionId,
      workspacePath: workspace.path,
    })

    log.info(`Worker started for ${issue.identifier}`, { sessionId, workspacePath: workspace.path })

    const runTurn = async (text: string) => {
      if (stopped) return
      turnCount++
      lastEventAt = Date.now()

      try {
        const messageID = Identifier.ascending("message")
        await SessionPrompt.prompt({
          sessionID: sessionId,
          messageID,
          agent: "symphony",
          parts: [{ type: "text", text } as any],
        })
        lastEventAt = Date.now()
      } catch (e) {
        log.error(`Turn ${turnCount} failed for ${issue.identifier}`, { error: e })
        throw e
      }
    }

    const runLoop = async () => {
      await runTurn(rendered)
      for (let i = 1; i < config.agent.max_turns && !stopped; i++) {
        await runTurn(`Continue working on ${issue.identifier}. Check if the task is complete.`)
      }
    }

    runLoop().catch((e) => {
      if (!stopped) {
        log.error(`Worker loop failed for ${issue.identifier}`, { error: e })
        Bus.publish(SymphonyEvent.WorkerFailed, {
          issueId: issue.id,
          identifier: issue.identifier,
          error: e instanceof Error ? e.message : String(e),
          attempt: attempt ?? 0,
        })
      }
    })

    const handle: WorkerHandle = {
      issueId: issue.id,
      identifier: issue.identifier,
      sessionId,

      async stop() {
        stopped = true
        SessionPrompt.cancel(sessionId)
        log.info(`Stopping worker for ${issue.identifier}`)
      },

      getStatus(): RunningEntry {
        return {
          issueId: issue.id,
          identifier: issue.identifier,
          state: issue.state,
          sessionId,
          workspacePath: workspace.path,
          turnCount,
          startedAt,
          lastEventAt,
          tokens: {
            input: inputTokens,
            output: outputTokens,
            total: totalTokens,
          },
        }
      },
    }

    return handle
  } catch (e) {
    throw new SymphonyDispatchError({
      message: `Failed to start worker for ${issue.identifier}: ${e instanceof Error ? e.message : String(e)}`,
      issueIdentifier: issue.identifier,
    })
  }
}
