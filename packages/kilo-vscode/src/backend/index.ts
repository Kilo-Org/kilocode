import { createSessionSearchMethods } from "./session-search"
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { createSessionMethods } from "./session"
import { createModelMethods } from "./models"
import { createPermissionMethods } from "./permissions"
import { createQuestionMethods } from "./questions"
import { createSettingsMethods } from "./settings"
import { createWorkspaceMethods } from "./workspace"
import { createRemoteMethods } from "./remote"
import { createAccountMethods } from "./account"
import { createGenerationMethods } from "./generation"
import { createMcpMethods } from "./mcp"
import { createNativePtyMethods, createPtyMethods } from "./pty"
import { createUsageMethods } from "./usage"
import { createMemoryMethods } from "./memory"
import { createPresenceMethods } from "./presence"
import { createProcessMethods } from "./processes"
import { createModelStateMethods } from "./model-state"
import { viewEvents } from "./events"
export type * from "./view-types"

export function createKiloClient(input: { client: OpenCodeClient; directory: string }) {
  const settings = createSettingsMethods(input.client, input.directory)
  const models = createModelMethods(input.client, input.directory)
  const account = createAccountMethods(input.client, input.directory)
  return {
    ...models,
    ...account,
    ...createMemoryMethods(input.client, input.directory),
    kilocode: createUsageMethods(input.client, input.directory),
    provider: { ...models.provider, ...account.provider, auth: account.providerAuth.list },
    ...createGenerationMethods(input.client, input.directory),
    ...createWorkspaceMethods(input.client, input.directory),
    experimental: { session: createSessionSearchMethods(input.client, input.directory) },
    session: {
      ...createSessionMethods(input.client, input.directory),
      ...createPresenceMethods(input.client),
    },
    permission: createPermissionMethods(input.client, input.directory),
    question: createQuestionMethods(input.client, input.directory),
    config: settings.config,
    remote: createRemoteMethods(input.client, input.directory),
    backgroundProcess: createProcessMethods(input.client, input.directory),
    modelState: createModelStateMethods(input.client, input.directory),
    mcp: createMcpMethods(input.client, input.directory),
    pty: createPtyMethods(input.client, input.directory),
    v2: { pty: createNativePtyMethods(input.client, input.directory) },
    global: {
      ...settings.global,
      event: async (options?: {
        signal?: AbortSignal
        sseMaxRetryAttempts?: number
        onSseError?: (error: unknown) => void
      }) => ({ stream: viewEvents(input.client, input.directory, options?.signal) }),
    },
  }
}

export type KiloClient = ReturnType<typeof createKiloClient>
