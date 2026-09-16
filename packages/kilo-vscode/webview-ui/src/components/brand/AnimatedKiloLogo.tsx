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

/**
 * Yellow slot-machine Kilo mark, mirrors Kilo Cloud's welcome logo hover animation.
 *
 * `onReady` reports whether the player can draw. The parent keeps the static mark visible until
 * that is true, so a slow or failed load never leaves an empty square on hover.
 */
export const AnimatedKiloLogo: Component<{ playing: boolean; onReady: (ready: boolean) => void }> = (props) => {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const [loaded, setLoaded] = createSignal(false)
  let canvas!: HTMLCanvasElement
  let player: DotLottie | undefined

  // A failed load leaves the canvas blank, so log it and let the static mark stay visible.
  const fail = (event: { error: Error }) => {
    console.warn("[Kilo New] animated Kilo logo failed to load:", event.error)
    setLoaded(false)
    props.onReady(false)
  }

  onMount(() => {
    const dl = new DotLottie({ canvas, src: `${icons}/kilo-yellow.lottie`, loop: true })
    // `play()` is a no-op until the animation and WASM renderer are loaded, so wait for `load`.
    dl.addEventListener("load", () => {
      setLoaded(true)
      props.onReady(true)
    })
    dl.addEventListener("loadError", fail)
    dl.addEventListener("renderError", fail)
    player = dl
    onCleanup(() => dl.destroy())
  })

  // Only burn cycles while the mark is visible.
  createEffect(() => {
    const dl = player
    if (!dl) return
    if (loaded() && props.playing) return dl.play()
    dl.pause()
  })

  return <canvas ref={canvas} class="kilo-logo-lottie" aria-hidden="true" />
}
