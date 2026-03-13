import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  // Agent Manager specific translations can be added here
} satisfies Partial<Record<Keys, string>>
