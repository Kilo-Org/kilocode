import { type Component, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { DotLottie } from "@lottiefiles/dotlottie-web"

/**
 * DotLottie defaults to a CDN for its WASM renderer. Point it at the copy esbuild ships next
 * to the webview bundles (see `wasm()` in esbuild.js) so the logo never reaches the network.
 * The shiki worker URI is the only `dist/` URI the host injects, so derive the WASM URI from it.
 */
const wasm = (window as { KILO_SHIKI_WORKER_URI?: string }).KILO_SHIKI_WORKER_URI?.replace(
  /shiki-worker\.js$/,
  "dotlottie-player.wasm",
)
if (wasm) DotLottie.setWasmUrl(wasm)

export const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/** Yellow slot-machine Kilo mark, mirrors Kilo Cloud's welcome logo hover animation. */
export const AnimatedKiloLogo: Component<{ playing: boolean }> = (props) => {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const [loaded, setLoaded] = createSignal(false)
  let canvas!: HTMLCanvasElement
  let player: DotLottie | undefined

  onMount(() => {
    const dl = new DotLottie({ canvas, src: `${icons}/kilo-yellow.lottie`, loop: true })
    // `play()` is a no-op until the animation and WASM renderer are loaded, so wait for `load`.
    dl.addEventListener("load", () => setLoaded(true))
    player = dl
    onCleanup(() => dl.destroy())
  })

  // Only burn cycles while the mark is visible.
  createEffect(() => {
    if (!loaded() || !player) return
    if (props.playing) return player.play()
    player.pause()
  })

  return <canvas ref={canvas} class="kilo-logo-lottie" aria-hidden="true" />
}
