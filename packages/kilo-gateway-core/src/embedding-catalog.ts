import { Schema } from "effect"

// The Gateway embedding catalog as the Kilo API sends it, decoded in `models.ts`. The `kilocode.gateway` RPC contract
// (packages/schema/src/kilocode/gateway.ts) declares the same shape for its `models.embeddings` answer; this package
// imports nothing from OpenCode, so packages/kilo-plugin/test/gateway.test.ts checks that the two stay equal.
export const EmbeddingCatalog = Schema.Struct({
  defaultModel: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      dimension: Schema.Int.check(Schema.isGreaterThan(0)),
      scoreThreshold: Schema.Finite,
      note: Schema.optionalKey(Schema.String),
    }),
  ),
  aliases: Schema.Record(Schema.String, Schema.String),
})

export type EmbeddingCatalog = typeof EmbeddingCatalog.Type
