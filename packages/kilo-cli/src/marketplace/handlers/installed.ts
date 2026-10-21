import { EOL } from "node:os"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { Marketplace } from "../commands"
import { call, connect, print } from "./client"

export default Runtime.handler(
  Marketplace.commands.installed,
  Effect.fn("cli.marketplace.installed")(function* () {
    const marketplace = yield* connect
    const records = yield* call(() => marketplace.rpc.installed({}, marketplace.options))
    if (records.length === 0) return yield* print(["Nothing installed from marketplaces"])
    yield* print(
      records.map((record) =>
        [`${record.kind} ${record.id} (${record.registry}, ${record.scope})`, ...record.paths, record.config]
          .filter(Boolean)
          .join(`${EOL}    `),
      ),
    )
  }),
)
