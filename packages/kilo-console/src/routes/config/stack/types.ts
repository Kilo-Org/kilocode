import type {
  StackApplyError,
  StackApplyResponse,
  StackCatalogResponse,
  StackPreviewInput,
  StackPreviewResponse,
  StackStateResponse,
} from "@kilocode/sdk/v2/client"

export type { StackApplyError, StackApplyResponse, StackCatalogResponse, StackPreviewResponse, StackStateResponse }

export type StackDraft = StackPreviewInput["draft"]
export type StackCatalog = StackCatalogResponse["catalog"]
export type StackVertical = StackCatalog["verticals"][number]
export type StackTechnology = StackVertical["technologies"][number]
export type StackAssociation = StackTechnology["resources"][number]
export type StackCategory = StackVertical["categories"][number]
export type StackResource = StackCatalog["resources"][number]
export type StackResourceSummary = StackCatalogResponse["resources"][number]
export type StackMarketplaceItem = NonNullable<StackResourceSummary["item"]>
export type StackMarketplaceMcp = Extract<StackMarketplaceItem, { kind: "mcp" }>
export type StackMethod = StackMarketplaceMcp["methods"][number]
export type StackParameterValue = string | number | boolean
export type StackParameter = {
  id: string
  label: string
  description?: string
  type: StackMethod["parameters"][number]["type"]
  required: boolean
  sensitive: boolean
  env?: string
  default?: StackParameterValue
  values?: StackParameterValue[]
}
export type StackPlanAction = StackPreviewResponse["actions"][number]
export type StackConflict = StackPreviewResponse["conflicts"][number]

export type StackBundle = {
  catalog: StackCatalogResponse
  state: StackStateResponse
}

export type StackResourceItem = {
  resource: StackResource
  association: StackAssociation
  availability: StackResourceSummary["availability"]
  reason?: string
  item?: StackResourceSummary["item"]
  default: boolean
  parameters: StackParameter[]
}
