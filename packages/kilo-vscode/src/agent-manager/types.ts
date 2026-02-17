import type * as vscode from "vscode"

export interface AgentSession {
  id: string
  label: string
  status: "creating" | "busy" | "idle" | "error"
  created: number
  directory: string
}

// Overview webview -> Extension host
export type AgentManagerMessage =
  | { type: "agentManager.ready" }
  | { type: "agentManager.createSession"; prompt: string }
  | { type: "agentManager.stopSession"; sessionId: string }
  | { type: "agentManager.deleteSession"; sessionId: string }
  | { type: "agentManager.selectSession"; sessionId: string }
  | { type: "agentManager.sidebarMessage"; sessionId: string; payload: unknown }

// Extension host -> Overview webview
export type AgentManagerEvent =
  | { type: "agentManager.sessions"; sessions: AgentSession[] }
  | { type: "agentManager.sessionCreated"; session: AgentSession }
  | { type: "agentManager.sessionUpdated"; session: AgentSession }
  | { type: "agentManager.sessionDeleted"; sessionId: string }
  | { type: "agentManager.sidebarEvent"; sessionId: string; payload: unknown }
  | { type: "agentManager.sidebarHtml"; html: string }
  | { type: "agentManager.error"; message: string }
