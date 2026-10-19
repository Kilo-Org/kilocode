import { Schema } from "effect"

// One definition for the Gateway embedding catalog, shared by the HTTP decoder in `models.ts` and the
// `kilocode.gateway` RPC contract. Keep this module free of runtime imports so the RPC contract stays light.
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
