import { resolver } from "hono-openapi"
import z from "zod"
import { NotFoundError } from "../storage/db"

/**
 * Standardized API error response format.
 * All API errors follow this structure for consistency across all endpoints.
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  errors: z.array(
    z.object({
      message: z.string().describe("Human-readable error message"),
      code: z.string().optional().describe("Error code for programmatic handling"),
      field: z.string().optional().describe("Field that caused the error (for validation errors)"),
      details: z.record(z.string(), z.any()).optional().describe("Additional error context"),
    }),
  ),
  data: z.null().describe("Always null on error responses"),
})

export const ERRORS = {
  400: {
    description: "Bad request - invalid input parameters",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "BadRequestError",
          }),
        ),
      },
    },
  },
  401: {
    description: "Unauthorized - authentication required",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "UnauthorizedError",
          }),
        ),
      },
    },
  },
  403: {
    description: "Forbidden - insufficient permissions",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "ForbiddenError",
          }),
        ),
      },
    },
  },
  404: {
    description: "Not found - resource does not exist",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.extend({
            errors: z.array(
              z.object({
                message: z.string(),
                code: z.string().optional(),
                resource: z.string().optional().describe("Type of resource that was not found"),
                id: z.string().optional().describe("ID of the resource that was not found"),
                details: z.record(z.string(), z.any()).optional(),
              }),
            ),
          }).meta({
            ref: "NotFoundError",
          }),
        ),
      },
    },
  },
  409: {
    description: "Conflict - resource conflict or duplicate",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "ConflictError",
          }),
        ),
      },
    },
  },
  429: {
    description: "Too many requests - rate limit exceeded",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "RateLimitError",
          }),
        ),
      },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponseSchema.meta({
            ref: "InternalError",
          }),
        ),
      },
    },
  },
} as const

/**
 * Helper function to include standardized error responses in OpenAPI route definitions.
 * @param codes - HTTP status codes to include in the response definitions
 * @returns Object mapping status codes to response definitions
 * @example
 * describeRoute({
 *   responses: {
 *     200: { ... },
 *     ...errors(400, 404, 500)
 *   }
 * })
 */
export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

/**
 * Create a standardized error response object.
 * @param message - Primary error message
 * @param code - Optional error code
 * @param field - Optional field name for validation errors
 * @param details - Optional additional context
 * @returns Standardized error response object
 */
export function createErrorResponse(
  message: string,
  code?: string,
  field?: string,
  details?: Record<string, any>,
) {
  return {
    success: false as const,
    errors: [{ message, code, field, details }],
    data: null,
  }
}

/**
 * Create a standardized not found error response.
 * @param resource - Type of resource
 * @param id - Resource identifier
 * @returns Standardized not found error response
 */
export function createNotFoundResponse(resource: string, id: string) {
  return {
    success: false as const,
    errors: [
      {
        message: `${resource} not found: ${id}`,
        code: "NOT_FOUND",
        resource,
        id,
      },
    ],
    data: null,
  }
}
