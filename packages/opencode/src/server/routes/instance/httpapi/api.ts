import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { ConfigApi } from "./groups/config"
import { ControlApi } from "./groups/control"
import { EventApi } from "./groups/event"
import { ExperimentalApi } from "./groups/experimental"
import { FileApi } from "./groups/file"
import { GlobalApi } from "./groups/global"
import { InstanceApi } from "./groups/instance"
import { McpApi } from "./groups/mcp"
import { PermissionApi } from "./groups/permission"
import { ProjectApi } from "./groups/project"
import { ProviderApi } from "./groups/provider"
import { PtyApi, PtyConnectApi } from "./groups/pty"
import { QuestionApi } from "./groups/question"
import { SessionApi } from "./groups/session"
import { SyncApi } from "./groups/sync"
import { TuiApi } from "./groups/tui"
import { WorkspaceApi } from "./groups/workspace"
import { V2Api } from "./groups/v2"
// kilocode_change start - Kilo HttpApi groups
import { AgentBuilderApi } from "@/kilocode/server/httpapi/groups/agent-builder"
import { BranchNameApi } from "@/kilocode/server/httpapi/groups/branch-name"
import { CommitMessageApi } from "@/kilocode/server/httpapi/groups/commit-message"
import { BackgroundProcessApi } from "@/kilocode/server/httpapi/groups/background-process"
import { ConfigConsoleApi } from "@/kilocode/server/httpapi/groups/config-console"
import { EnhancePromptApi } from "@/kilocode/server/httpapi/groups/enhance-prompt"
import { IndexingApi } from "@/kilocode/server/httpapi/groups/indexing"
import { InteractiveTerminalApi } from "@/kilocode/server/httpapi/groups/interactive-terminal"
import { KiloGatewayApi } from "@/kilocode/server/httpapi/groups/kilo-gateway"
import { KilocodeApi } from "@/kilocode/server/httpapi/groups/kilocode"
import { NetworkApi } from "@/kilocode/server/httpapi/groups/network"
import { RemoteApi } from "@/kilocode/server/httpapi/groups/remote"
import { SandboxApi } from "@/kilocode/server/httpapi/groups/sandbox"
import { SessionImportApi } from "@/kilocode/server/httpapi/groups/session-import"
import { SuggestionApi } from "@/kilocode/server/httpapi/groups/suggestion"
import { TelemetryApi } from "@/kilocode/server/httpapi/groups/telemetry"
// kilocode_change end
import { Authorization } from "./middleware/authorization"
import { SchemaErrorMiddleware } from "./middleware/schema-error"

// SSE event schemas built from the BusEvent/SyncEvent registries.
const EventSchema = Schema.Union(BusEvent.effectPayloads()).annotate({ identifier: "Event" })
const SyncEventSchemas = SyncEvent.effectPayloads()

export const RootHttpApi = HttpApi.make("opencode-root")
  .addHttpApi(ControlApi)
  .addHttpApi(GlobalApi)
  .middleware(SchemaErrorMiddleware)
  .middleware(Authorization)

export const InstanceHttpApi = HttpApi.make("opencode-instance")
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(FileApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(McpApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(PtyApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SyncApi)
  .addHttpApi(V2Api)
  .addHttpApi(TuiApi)
  .addHttpApi(WorkspaceApi)
  // kilocode_change start - Kilo HttpApi groups
  .addHttpApi(AgentBuilderApi)
  .addHttpApi(BackgroundProcessApi)
  .addHttpApi(BranchNameApi)
  .addHttpApi(CommitMessageApi)
  .addHttpApi(ConfigConsoleApi)
  .addHttpApi(EnhancePromptApi)
  .addHttpApi(IndexingApi)
  .addHttpApi(InteractiveTerminalApi)
  .addHttpApi(KiloGatewayApi)
  .addHttpApi(KilocodeApi)
  .addHttpApi(NetworkApi)
  .addHttpApi(RemoteApi)
  .addHttpApi(SandboxApi)
  .addHttpApi(SessionImportApi)
  .addHttpApi(SuggestionApi)
  .addHttpApi(TelemetryApi)
  // kilocode_change end
  .middleware(SchemaErrorMiddleware)

export const OpenCodeHttpApi = HttpApi.make("opencode")
  .addHttpApi(RootHttpApi)
  .addHttpApi(EventApi)
  .addHttpApi(InstanceHttpApi)
  .addHttpApi(PtyConnectApi)
  .annotate(HttpApi.AdditionalSchemas, [EventSchema, ...SyncEventSchemas])

export type RootHttpApiType = typeof RootHttpApi
export type InstanceHttpApiType = typeof InstanceHttpApi
