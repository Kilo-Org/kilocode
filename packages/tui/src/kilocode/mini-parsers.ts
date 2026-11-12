import { addDefaultParsers } from "@opentui/core"
import parsers from "../parsers-config"

// `mini` builds its own renderer instead of going through the full TUI session
// route, which is where the parser config is normally registered. Without this
// the tree-sitter client only knows OpenTUI's bundled parsers, so fenced code
// in every other language renders as plain text.
export function registerMiniParsers() {
  addDefaultParsers(parsers.parsers)
}
