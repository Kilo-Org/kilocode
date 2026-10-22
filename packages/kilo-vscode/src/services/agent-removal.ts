import { getErrorMessage } from "../kilo-provider-utils"
import type { KiloConnectionService } from "./cli-backend"
import type { RemoveResult } from "./marketplace/types"

interface Input {
  connection: KiloConnectionService
  directory: string
  name: string
  scope?: "project" | "global"
}

export async function removeAgent(input: Input): Promise<RemoveResult> {
  try {
    const client = await input.connection.getClientAsync(input.directory)
    const result = await client.kilocode.removeAgent({
      name: input.name,
      directory: input.directory,
      scope: input.scope,
    })
    if (!result.error) return { success: true, slug: input.name }

    return {
      success: false,
      slug: input.name,
      error: getErrorMessage(result.error) || `Agent "${input.name}" is still provided by another configuration.`,
    }
  } catch (err) {
    return {
      success: false,
      slug: input.name,
      error: getErrorMessage(err) || `Failed to remove agent "${input.name}".`,
    }
  }
}
