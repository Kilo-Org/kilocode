export function source(data: string): string | undefined {
  if (!data.startsWith("data:")) return `data:image/jpeg;base64,${data}`
  return /^data:image\/(?:jpeg|png|webp);base64,/.test(data) ? data : undefined
}

export interface BrowserViewIdentity {
  browserId: string
  navigation: number
  revision: number
}

export interface BrowserViewport {
  width: number
  height: number
  scale?: number
  revision: number
  active: boolean
}

export interface BrowserFrame extends BrowserViewIdentity {
  sequence: number
  width: number
  height: number
  data: string
}

export type BrowserInteraction =
  | {
      kind: "pointer"
      action: "move" | "down" | "up"
      x: number
      y: number
      button: "left" | "middle" | "right"
      buttons: number
      clicks: number
      modifiers: number
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | {
      kind: "key"
      action: "down" | "up"
      key: string
      code: string
      keyCode: number
      modifiers: number
      repeat: boolean
      text?: string
    }
  | { kind: "text"; text: string }
  | { kind: "composition"; text: string; start: number; end: number }
  | { kind: "clipboard"; action: "copy" | "cut" | "paste" }
  | { kind: "release" }
