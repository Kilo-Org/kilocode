import type { KiloConnectionService } from "../services/cli-backend"
import type { StackApiError, StackApplyResult, StackDraft, StackLoadData, StackPlan } from "./types"
import { stackPreviewInput } from "./types"

export interface StackClient {
  load(directory: string): Promise<StackLoadData>
  preview(directory: string, draft: StackDraft): Promise<StackPlan>
  apply(directory: string, draft: StackDraft, planHash: string): Promise<StackApplyResult>
}

export class StackClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    readonly detail?: StackApiError,
  ) {
    super(message)
    this.name = "StackClientError"
  }
}

function code(error: StackApiError): string | undefined {
  if ("code" in error && typeof error.code === "string") return error.code
  if ("_tag" in error && typeof error._tag === "string") return error._tag
  return
}

function message(error: StackApiError, fallback: string): string {
  if ("message" in error && typeof error.message === "string") return error.message
  return fallback
}

function failure(error: StackApiError, status: number, fallback: string): StackClientError {
  return new StackClientError(message(error, fallback), code(error), status, error)
}

export class StackHttpClient implements StackClient {
  constructor(private readonly connection: KiloConnectionService) {}

  async load(directory: string): Promise<StackLoadData> {
    const client = await this.connection.getClientAsync(directory)
    const [catalog, state] = await Promise.all([client.stack.catalog({ directory }), client.stack.get({ directory })])
    if (catalog.error) {
      throw failure(catalog.error, catalog.response.status, "Stack catalog request failed")
    }
    if (state.error) throw failure(state.error, state.response.status, "Stack state request failed")
    if (!catalog.data || !state.data) throw new StackClientError("Stack load returned an empty response")
    return { catalog: catalog.data, state: state.data }
  }

  async preview(directory: string, draft: StackDraft): Promise<StackPlan> {
    const client = await this.connection.getClientAsync(directory)
    const result = await client.stack.preview({ directory, stackPreviewInput: stackPreviewInput(draft) })
    if (result.error) throw failure(result.error, result.response.status, "Stack preview request failed")
    if (!result.data) throw new StackClientError("Stack preview returned an empty response")
    return result.data
  }

  async apply(directory: string, draft: StackDraft, planHash: string): Promise<StackApplyResult> {
    const client = await this.connection.getClientAsync(directory)
    const result = await client.stack.apply({
      directory,
      stackApplyInput: { draft: stackPreviewInput(draft).draft, plan_hash: planHash },
    })
    if (result.error) throw failure(result.error, result.response.status, "Stack apply request failed")
    if (!result.data) throw new StackClientError("Stack apply returned an empty response")
    return result.data
  }
}
