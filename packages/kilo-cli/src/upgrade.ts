import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { KiloUpdater } from "./updater"

export default Runtime.handler(Commands.commands.upgrade, () => Effect.fail(new Error(KiloUpdater.message)))
