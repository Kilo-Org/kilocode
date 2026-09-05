import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Match, Switch, type JSX } from "solid-js"
import { logo, supports } from "./logo-data"

export type KiloLogoProps = {
  fg: RGBA
  bg: RGBA
  width?: number
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export function KiloLogo(props: KiloLogoProps) {
  const dimensions = useTerminalDimensions()
  const width = createMemo(() => props.width ?? Math.max(0, dimensions().width - 4))
  const artwork = createMemo(() => (supports(props.env, props.platform) ? logo.modern : logo.fallback))

  return (
    <Switch>
      <Match when={width() < 30}>
        <text id="kilo-home-logo" fg={props.fg} wrapMode="none" flexShrink={0} selectable={false}>
          KILO
        </text>
      </Match>
      <Match when={width() < 52}>
        <Artwork lines={artwork().compact} fg={props.fg} bg={props.bg} />
      </Match>
      <Match when={true}>
        <Artwork lines={artwork().tui} fg={props.fg} bg={props.bg} />
      </Match>
    </Switch>
  )
}

function Artwork(props: { lines: string[]; fg: RGBA; bg: RGBA }) {
  const shadow = createMemo(() =>
    RGBA.fromValues(
      props.bg.r + (props.fg.r - props.bg.r) * 0.25,
      props.bg.g + (props.fg.g - props.bg.g) * 0.25,
      props.bg.b + (props.fg.b - props.bg.b) * 0.25,
    ),
  )

  return (
    <text id="kilo-home-logo" fg={props.fg} wrapMode="none" flexShrink={0} selectable={false}>
      <For each={props.lines}>
        {(line, index) => (
          <>
            {renderLine(line, props.fg, shadow())}
            {index() < props.lines.length - 1 ? "\n" : ""}
          </>
        )}
      </For>
    </text>
  )
}

function renderLine(line: string, fg: RGBA, shadow: RGBA): JSX.Element[] {
  return line
    .split(/(~)/)
    .filter(Boolean)
    .map((value) => <span style={{ fg: value === "~" ? shadow : fg }}>{value === "~" ? "▀" : value}</span>)
}
