import { useConfig } from "../config"
import { permissionModeOverride } from "../kilocode/permission-mode" // kilocode_change(autoapprove) - runtime auto-approve switch
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type PermissionMode = "prompt" | "autoaccept"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const config = useConfig()
    return {
      get mode(): PermissionMode {
        return permissionModeOverride() ?? (args.auto ? "autoaccept" : config.data.session.permissions) // kilocode_change(autoapprove) - a runtime toggle overrides the configured mode
      },
    }
  },
})
