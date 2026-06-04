import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { KilocodeKeybinds } from "@/kilocode/tui/keybinds"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const Scope = Schema.Literals(["global", "project"])
const Scoped = Scope.annotate({ default: "project" })
const TuiScope = Schema.Literals(["project", "global"])
const TuiScoped = TuiScope.annotate({ default: "project" })
const ProjectScope = Schema.Literal("project").annotate({ default: "project" })
const Origin = Schema.Literals(["project", "global", "system", "default"])
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)
const ModelRef = Schema.Struct({ providerID: Schema.String, modelID: Schema.String })
const Resolved = Schema.Struct({
  key: Schema.String,
  path: Schema.Array(Schema.String),
  value: Schema.optional(Schema.Unknown),
  global: Schema.optional(Schema.Unknown),
  local: Schema.optional(Schema.Unknown),
  source: Origin,
  inherited: Schema.Boolean,
  overridden: Schema.Boolean,
  editable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
})
const Source = Schema.Struct({
  order: Schema.Number,
  kind: Schema.String,
  scope: Schema.String,
  label: Schema.String,
  source: Schema.String,
  path: Schema.optional(Schema.String),
  exists: Schema.Boolean,
  editable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
})

export const ConfigOverlayQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Scoped),
})
export const ConfigOverlayPatch = Schema.Struct({
  scope: Schema.optional(Scoped),
  set: Schema.optional(UnknownRecord),
  unset: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
})
export const ConfigRulesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(ProjectScope),
})
const ConfigRulesFile = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  exists: Schema.Boolean,
  editable: Schema.Boolean,
  content: Schema.String,
})
export const ConfigRulesResponse = Schema.Struct({
  scope: Schema.Literal("project"),
  target: Schema.String,
  files: Schema.Array(ConfigRulesFile),
}).annotate({ identifier: "ConfigRulesResponse" })
export const ConfigRulesPatch = Schema.Struct({
  scope: Schema.optional(ProjectScope),
  content: Schema.String,
})
export const ConfigOverlayResponse = Schema.Struct({
  scope: Scope,
  effective: Config.Info,
  global: Config.Info,
  project: Config.Info,
  sources: Schema.Array(Source),
  targets: Schema.Struct({
    global: Schema.optional(Schema.String),
    project: Schema.optional(Schema.String),
    active: Schema.optional(Schema.String),
  }),
  fields: Schema.Record(Schema.String, Resolved),
  collections: Schema.Record(Schema.String, Schema.Array(Resolved)),
}).annotate({ identifier: "ConfigOverlayResponse" })
export const ConfigSourcesResponse = Schema.Struct({ sources: Schema.Array(Source) }).annotate({
  identifier: "ConfigSourcesResponse",
})
export const ConfigModelStatePatch = Schema.Struct({ favorite: Schema.optional(Schema.Array(ModelRef)) })
export const ConfigModelStateResponse = Schema.Struct({
  model: Schema.Record(Schema.String, ModelRef),
  recent: Schema.Array(ModelRef),
  favorite: Schema.Array(ModelRef),
  variant: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "ConfigModelStateResponse" })

export const TuiConfigQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(TuiScoped),
})
const TuiConfigShape = {
  $schema: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
  keybinds: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  plugin: Schema.optional(Schema.Array(ConfigPlugin.Spec)),
  plugin_enabled: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  scroll_speed: Schema.optional(Schema.Number),
  scroll_acceleration: Schema.optional(Schema.Struct({ enabled: Schema.Boolean })),
  diff_style: Schema.optional(Schema.Literals(["auto", "stacked"])),
  mouse: Schema.optional(Schema.Boolean),
  attention: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      notifications: Schema.optional(Schema.Boolean),
      sound: Schema.optional(Schema.Boolean),
      volume: Schema.optional(Schema.Number),
    }),
  ),
}
export const TuiConfigResponse = Schema.Struct(TuiConfigShape).annotate({ identifier: "TuiConfigGetResponse" })
export const TuiConfigPatch = Schema.Struct(TuiConfigShape)
export const TuiKeybindListResponse = Schema.Struct({ keybinds: Schema.Array(KilocodeKeybinds.Info) }).annotate({
  identifier: "TuiKeybindListResponse",
})

export const ConfigConsolePaths = {
  sources: "/config/sources",
  effective: "/config/effective",
  overlay: "/config/overlay",
  rules: "/config/rules",
  modelState: "/config/model-state",
  tuiConfig: "/tui/config",
  tuiKeybinds: "/tui/keybinds",
} as const

export const ConfigConsoleApi = HttpApi.make("config-console")
  .add(
    HttpApiGroup.make("config-console")
      .add(
        HttpApiEndpoint.get("overlay", ConfigConsolePaths.overlay, {
          query: ConfigOverlayQuery,
          success: described(ConfigOverlayResponse, "Resolved config overlay"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.overlay",
            summary: "Get config overlay",
            description:
              "Resolve global, project, and effective config values with source metadata for inheritance-aware settings UI.",
          }),
        ),
        HttpApiEndpoint.get("sources", ConfigConsolePaths.sources, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigSourcesResponse, "Config source inventory"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.sources",
            summary: "List config sources",
            description: "List config source metadata in load order without exposing config contents or secrets.",
          }),
        ),
        HttpApiEndpoint.get("effective", ConfigConsolePaths.effective, {
          query: WorkspaceRoutingQuery,
          success: described(Config.Info, "Effective config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.effective",
            summary: "Get effective configuration",
            description: "Retrieve effective config for the current instance directory.",
          }),
        ),
        HttpApiEndpoint.patch("overlayUpdate", ConfigConsolePaths.overlay, {
          query: WorkspaceRoutingQuery,
          payload: ConfigOverlayPatch,
          success: described(Config.Info, "Effective configuration after patch"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.overlayUpdate",
            summary: "Patch config overlay",
            description:
              "Apply a minimal global or project config patch, including unset paths for reverting local overrides.",
          }),
        ),
        HttpApiEndpoint.get("rules", ConfigConsolePaths.rules, {
          query: ConfigRulesQuery,
          success: described(ConfigRulesResponse, "Project rules"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.rules",
            summary: "Get project rules",
            description: "List project instruction files used by Kilo and return their current contents.",
          }),
        ),
        HttpApiEndpoint.put("rulesUpdate", ConfigConsolePaths.rules, {
          query: WorkspaceRoutingQuery,
          payload: ConfigRulesPatch,
          success: described(ConfigRulesResponse, "Project rules after update"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.rulesUpdate",
            summary: "Update project rules",
            description: "Create or update the project AGENTS.md rules file.",
          }),
        ),
        HttpApiEndpoint.get("modelState", ConfigConsolePaths.modelState, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigModelStateResponse, "Model state"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.modelState",
            summary: "Get model state",
            description: "Retrieve TUI-compatible recent and favorite model selections.",
          }),
        ),
        HttpApiEndpoint.patch("modelStateUpdate", ConfigConsolePaths.modelState, {
          query: WorkspaceRoutingQuery,
          payload: ConfigModelStatePatch,
          success: described(ConfigModelStateResponse, "Updated model state"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.modelStateUpdate",
            summary: "Update model state",
            description: "Patch TUI-compatible model selections shared with Kilo Console.",
          }),
        ),
        HttpApiEndpoint.get("tuiConfigGet", ConfigConsolePaths.tuiConfig, {
          query: WorkspaceRoutingQuery,
          success: described(TuiConfigResponse, "Effective TUI configuration"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.config.get",
            summary: "Get TUI configuration",
            description: "Retrieve the effective TUI configuration for the current instance directory.",
          }),
        ),
        HttpApiEndpoint.get("tuiKeybindList", ConfigConsolePaths.tuiKeybinds, {
          query: WorkspaceRoutingQuery,
          success: described(TuiKeybindListResponse, "TUI keybind metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.keybind.list",
            summary: "List TUI keybinds",
            description:
              "List valid TUI keybind commands, descriptions, groups, and default bindings from the CLI schema.",
          }),
        ),
        HttpApiEndpoint.patch("tuiConfigUpdate", ConfigConsolePaths.tuiConfig, {
          query: TuiConfigQuery,
          payload: TuiConfigPatch,
          success: described(TuiConfigResponse, "Effective TUI configuration after the update"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.config.update",
            summary: "Update TUI configuration",
            description: "Patch global or project TUI configuration and return the effective TUI configuration.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "config-console", description: "Kilo Console config routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
