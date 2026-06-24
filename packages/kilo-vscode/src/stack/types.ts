import type {
  StackApplyError2 as SdkStackApplyFailure,
  StackApplyResponse as SdkStackApplyResponse,
  StackCatalogError as SdkStackCatalogFailure,
  StackCatalogResponse as SdkStackCatalogResponse,
  StackGetError as SdkStackGetFailure,
  StackPreviewError as SdkStackPreviewFailure,
  StackPreviewInput,
  StackPreviewResponse as SdkStackPreviewResponse,
  StackStateResponse as SdkStackStateResponse,
} from "@kilocode/sdk/v2/client"

export type StackCatalog = SdkStackCatalogResponse
export type StackProjectState = SdkStackStateResponse
export type StackPlan = SdkStackPreviewResponse
export type StackApplyResult = SdkStackApplyResponse
export type StackApplyFailure = Extract<SdkStackApplyFailure, { code: "apply_failed" }>
export type StackApiError = SdkStackCatalogFailure | SdkStackGetFailure | SdkStackPreviewFailure | SdkStackApplyFailure

export type StackCatalogData = StackCatalog["catalog"]
export type StackVertical = StackCatalogData["verticals"][number]
export type StackTechnology = StackVertical["technologies"][number]
export type StackAssociation = StackTechnology["resources"][number]
export type StackCategory = StackVertical["categories"][number]
export type StackResource = StackCatalogData["resources"][number]
export type StackResourceSummary = StackCatalog["resources"][number]
export type StackMarketplaceItem = NonNullable<StackResourceSummary["item"]>
export type StackMcpItem = Extract<StackMarketplaceItem, { kind: "mcp" }>
export type StackMcpMethod = StackMcpItem["methods"][number]
export type StackParameter = StackMcpMethod["parameters"][number]
export type StackPlanAction = StackPlan["actions"][number]
export type StackPlanStatus = StackPlanAction["action"]
export type StackResourceKey = StackResource["ref"]
export type StackParameterValue = string | number | boolean

export interface StackResourceConfig {
  enabled: boolean
  method?: string
  parameters?: Record<string, StackParameterValue>
}

export interface StackDraft {
  verticals: Record<string, { technologies: string[] }>
  resources: Record<string, StackResourceConfig>
}

export interface StackResourceChoice {
  resource: StackResource
  association: StackAssociation
  availability: StackResourceSummary["availability"]
  reason?: string
  item?: StackMarketplaceItem
}

export interface StackLoadData {
  catalog: StackCatalog
  state: StackProjectState
}

export function stackPreviewInput(draft: StackDraft): StackPreviewInput {
  return { draft }
}

export interface StackLoadResultMessage {
  type: "stackLoadResult"
  data: StackLoadData
}

export interface StackPreviewResultMessage {
  type: "stackPreviewResult"
  plan: StackPlan
}

export interface StackApplyResultMessage {
  type: "stackApplyResult"
  result: StackApplyResult
  data?: StackLoadData
  refreshError?: string
}

export interface StackApplyFailureMessage {
  type: "stackApplyFailure"
  failure: StackApplyFailure
  data?: StackLoadData
  refreshError?: string
}

export interface StackProjectRequiredMessage {
  type: "stackProjectRequired"
}

export interface StackErrorMessage {
  type: "stackError"
  operation: "load" | "preview" | "apply"
  message: string
  code?: string
  stale?: boolean
  data?: StackLoadData
  refreshError?: string
}

export type StackExtensionMessage =
  | StackLoadResultMessage
  | StackPreviewResultMessage
  | StackApplyResultMessage
  | StackApplyFailureMessage
  | StackProjectRequiredMessage
  | StackErrorMessage

export interface StackLoadMessage {
  type: "stackLoad"
}

export interface StackPreviewMessage {
  type: "stackPreview"
  draft: StackDraft
}

export interface StackApplyMessage {
  type: "stackApply"
  draft: StackDraft
  planHash: string
}

export interface StackCancelMessage {
  type: "stackCancel"
}

export interface StackRestoreProjectMessage {
  type: "stackRestoreProject"
  directory: string
}

export type StackWebviewMessage =
  | StackLoadMessage
  | StackPreviewMessage
  | StackApplyMessage
  | StackCancelMessage
  | StackRestoreProjectMessage
