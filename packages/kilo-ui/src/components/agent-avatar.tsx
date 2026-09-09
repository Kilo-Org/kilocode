import { createContext, createMemo, For, useContext, type Accessor, type JSX } from "solid-js"
import { identity, palette } from "./agent-avatar-identity"

export type AgentAvatarStatus = "running"

// Map a tool part status to the only avatar state that changes its rendering.
// Finished, errored, cancelled, and waiting children all keep the static glyph.
export function taskStatus(status: string | undefined): AgentAvatarStatus | undefined {
  return status === "pending" || status === "running" ? "running" : undefined
}

// Sibling-aware colors. Surfaces that know the child list of one parent session
// provide it here, so the same agent gets the same color in every surface and
// siblings avoid sharing a color until the palette runs out.
const Palette = createContext<Accessor<Map<string, number>>>()

export function AgentAvatarPalette(props: { ids: string[]; children: JSX.Element }) {
  const parent = useContext(Palette)
  const value = createMemo(() => palette(props.ids))
  // The outermost provider wins so nested transcripts keep the parent's colors.
  return <Palette.Provider value={parent ?? value}>{props.children}</Palette.Provider>
}

export function useAgentAvatarIds() {
  const shared = useContext(Palette)
  return createMemo(() => (shared ? [...shared().keys()] : []))
}

// Corner cells are dropped so the dot grid reads as a circle.
const GRID = Array.from({ length: 25 }, (_, index) => index).filter((index) => ![0, 4, 20, 24].includes(index))

// Same cell geometry as the loading spinner, drawn as round dots on a 1px gap grid.
export function AgentAvatar(props: { id: string; status?: AgentAvatarStatus }) {
  const shared = useContext(Palette)
  const avatar = createMemo(() => identity(props.id))
  const color = createMemo(() => shared?.().get(props.id) ?? avatar().color)
  const lit = createMemo(() => new Set(avatar().cells))
  return (
    <svg
      data-component="agent-avatar"
      data-color={color()}
      data-status={props.status}
      width="18"
      height="18"
      viewBox="0 0 19 19"
      aria-hidden="true"
    >
      <For each={GRID}>
        {(cell) => (
          <circle
            data-lit={lit().has(cell) || undefined}
            cx={(cell % 5) * 4 + 1.5}
            cy={Math.floor(cell / 5) * 4 + 1.5}
            r="1.5"
            style={{ "animation-delay": `${-(((cell * 7) % 11) / 11) * 1.4}s` }}
          />
        )}
      </For>
    </svg>
  )
}
