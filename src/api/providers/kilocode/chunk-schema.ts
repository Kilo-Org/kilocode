import * as z from "zod/v4"

export const OpenRouterChunkSchema = z.object({
	provider: z.string().optional(),
})

export const VercelAiGatewayChunkSchema = z.object({
	choices: z.array(
		z.object({
			delta: z.object({
				provider_metadata: z
					.object({
						gateway: z
							.object({
								routing: z
									.object({
										resolvedProvider: z.string().optional(),
									})
									.optional(),
							})
							.optional(),
					})
					.optional(),
			}),
		}),
	),
})

export const KiloCodeChunkSchema = OpenRouterChunkSchema.and(VercelAiGatewayChunkSchema)
