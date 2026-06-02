import { createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation } from "@solidjs/router"
import { ThemeProvider } from "@kilocode/kilo-web-ui/theme"
import { ConsoleLayout } from "./layouts/ConsoleLayout"
import { path as route } from "./shared/navigation"

export default function App(props: { children?: JSX.Element }) {
  const loc = useLocation()
  const current = createMemo(() => route(loc.pathname))

  return (
    <ThemeProvider defaultTheme="kilo">
      <ConsoleLayout path={current()}>{props.children}</ConsoleLayout>
    </ThemeProvider>
  )
}
