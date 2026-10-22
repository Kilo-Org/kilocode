// esbuild.js applies script/virtua.patch (the virtua 0.49.1 patch of Kilo v1) when it bundles the webview. The patch
// adds `measure()` to the Solid virtualizer handle and clamps the rendered range to the data length.
import "virtua/solid"

declare module "virtua/solid" {
  interface VirtualizerHandle {
    /** Synchronously measure currently mounted items and update cached item sizes. */
    measure(): void
  }
}
