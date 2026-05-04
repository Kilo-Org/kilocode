import type { PanelContext } from "../types"
import type { DiffSource, DiffSourceDescriptor } from "./types"

/**
 * Enumerates and constructs diff sources for a PanelContext
 */
export class DiffSourceCatalog {
  listAvailable(_ctx: PanelContext): DiffSourceDescriptor[] {
    return []
  }

  build(id: string, _ctx: PanelContext): DiffSource {
    throw new Error(`DiffSourceCatalog.build("${id}"): not implemented yet`)
  }
}
