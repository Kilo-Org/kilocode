// kilocode_change - new file
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"

export namespace SubagentSpawn {
  export interface Input {
    parentSessionID: SessionID
    title: string
    permission: Permission.Ruleset
    prompt: string
    model: {
      modelID: ModelID
      providerID: ProviderID
    }
    agent: string
    tools: Record<string, boolean>
  }

  export interface Prepared {
    childSessionID: SessionID
    childUserMessageID: MessageID
    launch: () => void
    completion: Promise<{
      resultMessageID: MessageID
    }>
  }

  export async function prepare(input: Input): Promise<Prepared> {
    const session = await Session.create({
      parentID: input.parentSessionID,
      title: input.title,
      permission: input.permission,
    })
    const childSessionID = session.id
    const childUserMessageID = MessageID.ascending()

    let resolveCompletion!: (value: { resultMessageID: MessageID }) => void
    let rejectCompletion!: (reason: unknown) => void
    const completion = new Promise<{ resultMessageID: MessageID }>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })

    let launched = false
    function launch() {
      if (launched) throw new Error("Background subagent launch already started")
      launched = true

      const running = (async () => {
        const parts = await SessionPrompt.resolvePromptParts(input.prompt)
        return SessionPrompt.prompt({
          messageID: childUserMessageID,
          sessionID: childSessionID,
          model: {
            modelID: input.model.modelID,
            providerID: input.model.providerID,
          },
          agent: input.agent,
          tools: input.tools,
          parts,
        })
      })()

      running.then(
        (message) => {
          resolveCompletion({ resultMessageID: message.info.id })
        },
        (error) => {
          rejectCompletion(error)
        },
      )
    }

    return {
      childSessionID,
      childUserMessageID,
      launch,
      completion,
    }
  }
}
