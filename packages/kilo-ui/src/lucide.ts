/**
 * Re-export Lucide icons for consumers of @kilocode/kilo-ui.
 * Only add icons here that are actually used — esbuild/Vite will
 * tree-shake unused exports but explicit re-exports keep the API small.
 */
export { default as Paperclip } from "lucide-solid/icons/paperclip"
export { default as WandSparkles } from "lucide-solid/icons/wand-sparkles"
