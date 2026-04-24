import { Schema } from "effect"
import { zod } from "@/util/effect-zod"

export class Server extends Schema.Class<Server>("ServerConfig")({
  port: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description: "Port to listen on",
  }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: kilo.local)", // kilocode_change
  }),
  cors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional domains to allow for CORS",
  }),
}) {
  static readonly zod = zod(this)
}

export * as ConfigServer from "./server"
