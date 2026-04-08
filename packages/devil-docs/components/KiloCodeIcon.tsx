import React from "react"
import { Icon } from "./Icon"

interface devilcodeIconProps {
  size?: string
}

export function devilcodeIcon({ size = "1.2em" }: devilcodeIconProps) {
  return <Icon src="/docs/img/devil-v1.svg" srcDark="/docs/img/devil-v1-white.svg" alt="devil Code Icon" size={size} />
}
