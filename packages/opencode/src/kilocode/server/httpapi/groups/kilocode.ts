import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/kilocode"

export const RemoveSkillPayload = Schema.Struct({
  location: Schema.String,
})

export const RemoveAgentPayload = Schema.Struct({
  name: Schema.String,
})

const Scope = Schema.Literals(["global", "project"])

export const InstallSkillPayload = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  scope: Scope,
})

export const RemoveInstalledSkillPayload = Schema.Struct({
  id: Schema.String,
  scope: Scope,
})

export const InstallSkillFolderPayload = Schema.Struct({
  path: Schema.String,
  scope: Scope,
})

export const SkillInstallResult = Schema.Struct({
  success: Schema.Boolean,
  slug: Schema.String,
  error: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
})

export const MarketplaceSkillItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  category: Schema.String,
  displayCategory: Schema.String,
  githubUrl: Schema.String,
  content: Schema.String,
})

export const MarketplaceSkillsResponse = Schema.Struct({
  items: Schema.Array(MarketplaceSkillItem),
  error: Schema.optional(Schema.String),
})

export const KilocodePaths = {
  heapSnapshot: `${root}/heap/snapshot`,
  removeSkill: `${root}/skill/remove`,
  removeAgent: `${root}/agent/remove`,
  installSkill: `${root}/skill/install`,
  removeInstalledSkill: `${root}/skill/installed/remove`,
  marketplaceSkills: `${root}/marketplace/skills`,
  installSkillFolder: `${root}/skill/install/folder`,
} as const

export const KilocodeApi = HttpApi.make("kilocode")
  .add(
    HttpApiGroup.make("kilocode")
      .add(
        HttpApiEndpoint.post("heapSnapshot", KilocodePaths.heapSnapshot, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.String, "Heap snapshot file path"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.heap.snapshot",
            summary: "Write heap snapshot",
            description: "Write a heap snapshot for the CLI process to the log directory.",
          }),
        ),
        HttpApiEndpoint.post("removeSkill", KilocodePaths.removeSkill, {
          query: WorkspaceRoutingQuery,
          payload: RemoveSkillPayload,
          success: described(Schema.Boolean, "Skill removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.removeSkill",
            summary: "Remove a skill",
            description: "Remove a skill by deleting its manifest from disk and clearing it from cache.",
          }),
        ),
        HttpApiEndpoint.post("removeAgent", KilocodePaths.removeAgent, {
          query: WorkspaceRoutingQuery,
          payload: RemoveAgentPayload,
          success: described(Schema.Boolean, "Agent removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.removeAgent",
            summary: "Remove a custom agent",
            description:
              "Remove a custom (non-native) agent by deleting its markdown file from disk and refreshing state.",
          }),
        ),
        HttpApiEndpoint.post("installSkill", KilocodePaths.installSkill, {
          query: WorkspaceRoutingQuery,
          payload: InstallSkillPayload,
          success: described(SkillInstallResult, "Skill install result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.installSkill",
            summary: "Install a skill from a tarball URL",
            description:
              "Download a skill tarball, extract it into ~/.kilo/skills/<id>/ (global) or <workspace>/.kilo/skills/<id>/ (project), and dispose the instance so skill state reloads.",
          }),
        ),
        HttpApiEndpoint.post("removeInstalledSkill", KilocodePaths.removeInstalledSkill, {
          query: WorkspaceRoutingQuery,
          payload: RemoveInstalledSkillPayload,
          success: described(SkillInstallResult, "Skill removal result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.removeInstalledSkill",
            summary: "Remove an installed skill directory",
            description:
              "Recursively delete a skill folder under ~/.kilo/skills/<id>/ (global) or <workspace>/.kilo/skills/<id>/ (project) and dispose the instance so skill state reloads.",
          }),
        ),
        HttpApiEndpoint.post("installSkillFolder", KilocodePaths.installSkillFolder, {
          query: WorkspaceRoutingQuery,
          payload: InstallSkillFolderPayload,
          success: described(SkillInstallResult, "Skill folder install result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.installSkillFolder",
            summary: "Register a local folder as a skill source",
            description:
              "Add a folder path to kilo.json skills.paths (or remove it if already present) so skills inside are discovered on next session start.",
          }),
        ),
        HttpApiEndpoint.get("marketplaceSkills", KilocodePaths.marketplaceSkills, {
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceSkillsResponse, "Marketplace skills list"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kilocode.marketplaceSkills",
            summary: "List marketplace skills",
            description: "Fetch the current list of skills available in the Kilo Marketplace.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "kilocode",
          description: "Kilo-specific routes.",
        }),
      )
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
