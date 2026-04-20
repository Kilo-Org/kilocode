export * from "@opencode-ai/ui/context"

export { RenderTargetProvider, useRenderTarget, RenderSurface, createFocusSignal } from "./render-target"
export type { RenderTargetKind, RenderTargetAdapter } from "./render-target"
// Phase 5: density context
export { DensityProvider, DensityContext, type DensityMode, type DensityContextValue, type DensityProviderProps } from "./density"
