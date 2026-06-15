import { DotLottie } from "@lottiefiles/dotlottie-web"
import { onCleanup, onMount } from "solid-js"

const src = `${import.meta.env.BASE_URL}logo.lottie`

export function LoadingLogo(props: { class?: string }) {
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    if (!canvas) return

    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const player = new DotLottie({
      autoplay: motion,
      canvas,
      loop: motion,
      src,
      renderConfig: {
        autoResize: true,
      },
    })

    onCleanup(() => player.destroy())
  })

  return (
    <canvas
      ref={(node) => (canvas = node)}
      class={`console-loading-logo${props.class ? ` ${props.class}` : ""}`}
      role="img"
      aria-label="Kilo loading animation"
    />
  )
}
