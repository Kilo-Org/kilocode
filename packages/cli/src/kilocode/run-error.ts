import { KiloGatewayError } from "@opencode/util/kilocode/gateway-errors"

export type StructuredRunError = {
  type: string
  message: string
  status?: number
  response?: { body: string }
}

export const parseKiloErrorCode = KiloGatewayError.parseCode
export const kiloErrorLine = KiloGatewayError.line

export function formatKiloRunError<T extends StructuredRunError>(error: T | undefined): T | undefined {
  if (!error) return undefined
  const message = KiloGatewayError.line(error)
  if (!message) return error
  return { ...error, message }
}
