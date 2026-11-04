import type { ThemeV1Json } from "../../tui/src/theme/v1"
import aura from "../../tui/src/theme/assets/aura.json" with { type: "json" }
import ayu from "../../tui/src/theme/assets/ayu.json" with { type: "json" }
import carbonfox from "../../tui/src/theme/assets/carbonfox.json" with { type: "json" }
import catppuccinFrappe from "../../tui/src/theme/assets/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "../../tui/src/theme/assets/catppuccin-macchiato.json" with { type: "json" }
import catppuccin from "../../tui/src/theme/assets/catppuccin.json" with { type: "json" }
import cobalt2 from "../../tui/src/theme/assets/cobalt2.json" with { type: "json" }
import cursor from "../../tui/src/theme/assets/cursor.json" with { type: "json" }
import dracula from "../../tui/src/theme/assets/dracula.json" with { type: "json" }
import everforest from "../../tui/src/theme/assets/everforest.json" with { type: "json" }
import flexoki from "../../tui/src/theme/assets/flexoki.json" with { type: "json" }
import github from "../../tui/src/theme/assets/github.json" with { type: "json" }
import gruvbox from "../../tui/src/theme/assets/gruvbox.json" with { type: "json" }
import kanagawa from "../../tui/src/theme/assets/kanagawa.json" with { type: "json" }
import lucentOrng from "../../tui/src/theme/assets/lucent-orng.json" with { type: "json" }
import material from "../../tui/src/theme/assets/material.json" with { type: "json" }
import matrix from "../../tui/src/theme/assets/matrix.json" with { type: "json" }
import mercury from "../../tui/src/theme/assets/mercury.json" with { type: "json" }
import monokai from "../../tui/src/theme/assets/monokai.json" with { type: "json" }
import nightowl from "../../tui/src/theme/assets/nightowl.json" with { type: "json" }
import nord from "../../tui/src/theme/assets/nord.json" with { type: "json" }
import onedark from "../../tui/src/theme/assets/one-dark.json" with { type: "json" }
import orng from "../../tui/src/theme/assets/orng.json" with { type: "json" }
import osakaJade from "../../tui/src/theme/assets/osaka-jade.json" with { type: "json" }
import palenight from "../../tui/src/theme/assets/palenight.json" with { type: "json" }
import rosepine from "../../tui/src/theme/assets/rosepine.json" with { type: "json" }
import solarized from "../../tui/src/theme/assets/solarized.json" with { type: "json" }
import synthwave84 from "../../tui/src/theme/assets/synthwave84.json" with { type: "json" }
import tokyonight from "../../tui/src/theme/assets/tokyonight.json" with { type: "json" }
import vercel from "../../tui/src/theme/assets/vercel.json" with { type: "json" }
import vesper from "../../tui/src/theme/assets/vesper.json" with { type: "json" }
import zenburn from "../../tui/src/theme/assets/zenburn.json" with { type: "json" }
import kilo from "./theme.json" with { type: "json" }

export type { ColorValue, Theme, ThemeColor, ThemeV1Json } from "../../tui/src/theme/v1"

export const DEFAULT_THEMES: Record<string, ThemeV1Json> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
  kilo,
}
