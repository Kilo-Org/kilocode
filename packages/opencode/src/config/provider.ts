import z from "zod"

export namespace ConfigProvider {
  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      family: z.string().optional(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      tool_call: z.boolean(),
      interleaved: z
        .union([
          z.literal(true),
          z
            .object({
              field: z.enum(["reasoning_content", "reasoning_details"]),
            })
            .strict(),
        ])
        .optional(),
      cost: z
        .object({
          input: z.number(),
          output: z.number(),
          cache_read: z.number().optional(),
          cache_write: z.number().optional(),
          context_over_200k: z
            .object({
              input: z.number(),
              output: z.number(),
              cache_read: z.number().optional(),
              cache_write: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      modalities: z
        .object({
          input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
          output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        })
        .optional(),
      experimental: z.boolean().optional(),
      status: z.enum(["alpha", "beta", "deprecated"]).optional(),
      provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()).optional(),
      variants: z
        .record(
          z.string(),
          // kilocode_change start - allow null values so removed variants can be deleted via stripNulls on save
          z
            .object({
              disabled: z.boolean().optional().describe("Disable this variant for the model"),
            })
            .catchall(z.any())
            .nullable(),
          // kilocode_change end
        )
        .optional()
        .describe("Variant-specific configuration"),
    })
    .partial()

  export const Info = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      options: z
        .object({
          apiKey: z.string().optional(),
          baseURL: z.string().optional(),
          enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
          setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
          // kilocode_change start
          timeout: z
            .union([
              z
                .number()
                .int()
                .positive()
                .describe(
                  "Timeout in milliseconds for requests to this provider. Default is 120000 (2 minutes). Set to false to disable timeout.",
                ),
              z.literal(false).describe("Disable timeout for this provider entirely."),
              // kilocode_change end
            ])
            .optional()
            .describe(
              "Timeout in milliseconds for requests to this provider. Default is 120000 (2 minutes). Set to false to disable timeout.", // kilocode_change
            ),
          chunkTimeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
            ),
        })
        .catchall(z.any())
        .optional(),
      models: z.record(z.string(), Model.nullable()).optional(), // kilocode_change - allow null values so removed models can be deleted via stripNulls on save
    })
    .partial()
    .strict()
    .meta({
      ref: "ProviderConfig",
    })

  export type Info = z.infer<typeof Info>
}
