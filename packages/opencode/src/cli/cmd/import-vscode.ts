import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { EOL } from "os"
import * as Path from "path"
import fs from "fs/promises"

// VS Code KiloCode storage paths
function getVSCodeStoragePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return Path.join(home, ".config", "Code - Insiders", "User", "globalStorage", "kilocode.kilo-code")
}

interface VSCodeSession {
  taskSessionMap: Record<string, string>
}

export interface VSCodeMessage {
  type: string
  say?: string
  text?: string
  ts?: number
}

/**
 * Find all VS Code KiloCode sessions
 */
export async function findVSCodeSessions(): Promise<Array<{ taskId: string; sessionId: string }>> {
  const basePath = getVSCodeStoragePath()
  const sessionsPath = Path.join(basePath, "sessions")
  
  const sessions: Array<{ taskId: string; sessionId: string }> = []
  
  try {
    const entries = await fs.readdir(sessionsPath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const sessionFile = Path.join(sessionsPath, entry.name, "session.json")
      const file = Bun.file(sessionFile)
      
      if (await file.exists()) {
        const data = await file.json() as VSCodeSession
        for (const [taskId, sessionId] of Object.entries(data.taskSessionMap || {})) {
          sessions.push({ taskId, sessionId })
        }
      }
    }
  } catch {
    // Directory doesn't exist or is empty
  }
  
  return sessions
}

/**
 * Read VS Code task messages
 */
export async function readVSCodeMessages(taskId: string): Promise<VSCodeMessage[]> {
  const basePath = getVSCodeStoragePath()
  const messagesPath = Path.join(basePath, "tasks", taskId, "ui_messages.json")
  const file = Bun.file(messagesPath)
  
  if (!(await file.exists())) {
    return []
  }
  
  return await file.json() as VSCodeMessage[]
}

/**
 * Transform VS Code messages to Kilo format
 */
export function transformVSCodeMessages(
  messages: VSCodeMessage[],
  sessionId: string,
  projectId: string
): {
  info: {
    id: string
    slug: string
    version: string
    projectID: string
    directory: string
    title: string
    permission: Array<{ permission: string; pattern: string; action: string }>
    time: { created: number; updated: number }
    summary: { additions: number; deletions: number; files: number }
  }
  messages: Array<{
    info: {
      id: string
      sessionID: string
      role: string
      time: { created: number }
      summary: { diffs: unknown[] }
      agent: string
      model: { providerID: string; modelID: string }
    }
    parts: Array<{
      id: string
      sessionID: string
      messageID: string
      type: string
      text: string
    }>
  }>
} {
  const now = Date.now()
  
  const sessionInfo = {
    id: `ses_${sessionId}`,
    slug: `vscode-${sessionId.slice(0, 8)}`,
    version: "1.0.21",
    projectID: projectId,
    directory: process.cwd(),
    title: "VS Code Session",
    permission: [
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "plan_enter", pattern: "*", action: "deny" },
      { permission: "plan_exit", pattern: "*", action: "deny" },
    ],
    time: { created: now, updated: now },
    summary: { additions: 0, deletions: 0, files: 0 },
  }
  
  const kiloMessages = messages
    .filter((m) => m.type === "say" && m.say === "text" && m.text)
    .map((m, idx) => {
      const msgId = `msg_${String(idx + 1).padStart(4, "0")}`
      const partId = `prt_${String(idx + 1).padStart(4, "0")}`
      const role = idx % 2 === 0 ? "user" : "assistant"
      
      return {
        info: {
          id: msgId,
          sessionID: sessionInfo.id,
          role,
          time: { created: m.ts || now },
          summary: { diffs: [] },
          agent: "code",
          model: { providerID: "kilo", modelID: "z-ai/glm-5:free" },
        },
        parts: [
          {
            id: partId,
            sessionID: sessionInfo.id,
            messageID: msgId,
            type: "text",
            text: m.text || "",
          },
        ],
      }
    })
  
  return {
    info: sessionInfo,
    messages: kiloMessages,
  }
}

export const VSCodeListCommand = cmd({
  command: "list",
  describe: "list VS Code KiloCode sessions",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const sessions = await findVSCodeSessions()
      
      if (sessions.length === 0) {
        process.stdout.write("No VS Code sessions found")
        process.stdout.write(EOL)
        return
      }
      
      process.stdout.write("Available VS Code sessions:")
      process.stdout.write(EOL)
      
      for (const { sessionId } of sessions) {
        process.stdout.write(`  ${sessionId}`)
        process.stdout.write(EOL)
      }
    })
  },
})

export const VSCodeImportCommand = cmd({
  command: "import <session-id>",
  describe: "import VS Code KiloCode session",
  builder: (yargs: Argv) =>
    yargs.positional("session-id", {
      describe: "VS Code session ID to import",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionId = args["session-id"]
      const sessions = await findVSCodeSessions()
      const session = sessions.find((s) => s.sessionId === sessionId)
      
      if (!session) {
        process.stdout.write(`Session not found: ${sessionId}`)
        process.stdout.write(EOL)
        return
      }
      
      const messages = await readVSCodeMessages(session.taskId)
      
      if (messages.length === 0) {
        process.stdout.write(`No messages found for session: ${sessionId}`)
        process.stdout.write(EOL)
        return
      }
      
      const exportData = transformVSCodeMessages(messages, sessionId, Instance.project.id)
      
      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)
      
      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)
        
        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }
      
      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
      process.stdout.write(`  Messages: ${exportData.messages.length}`)
      process.stdout.write(EOL)
    })
  },
})

export const VSCodeCommand = cmd({
  command: "vscode",
  describe: "manage VS Code KiloCode sessions",
  builder: (yargs: Argv) => yargs.command(VSCodeListCommand).command(VSCodeImportCommand).demandCommand(),
  async handler() {},
})
