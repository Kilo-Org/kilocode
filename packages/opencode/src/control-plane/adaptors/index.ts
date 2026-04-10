import { lazy } from "@/util/lazy"
import type { Adaptor } from "../types"

const ADAPTORS: Record<string, () => Promise<Adaptor>> = {
  worktree: lazy(async () => (await import("./worktree")).WorktreeAdaptor),
}

export function getAdaptor(type: string): Promise<Adaptor> {
  return ADAPTORS[type]()
}

export function installAdaptor(type: string, adaptor: Adaptor) {
  // This is experimental: mostly used for testing right now, but we
  // will likely allow this in the future. Need to figure out the
  // TypeScript story
  // We force the builtin types right now, but will implement a way
  // to extend the types for custom adaptors
  // devilcode_change - cast through unknown to satisfy tsgo strict overlap check
  ;(ADAPTORS as unknown as Record<string, () => Adaptor>)[type] = () => adaptor
}
