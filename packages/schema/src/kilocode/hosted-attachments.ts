export * as HostedAttachments from "./hosted-attachments.js"
import { Schema } from "effect"

export const Mime = Schema.Literals(["image/png", "image/jpeg", "image/webp", "image/gif"])
const uuid = Schema.String.check(Schema.isUUID())
export const Handles = Schema.Array(uuid).check(Schema.isMinLength(1), Schema.isMaxLength(5))
export const MAX_BYTES = 20 * 1024 * 1024
export const Image = Schema.Struct({
  id: uuid,
  mime: Mime,
  base64: Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(4 * Math.ceil(MAX_BYTES / 3))),
})
export interface Image extends Schema.Schema.Type<typeof Image> {}
export const isImage = Schema.is(Image)
