import { createMemo, Suspense } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation } from "@solidjs/router"
import { ThemeProvider } from "@kilocode/kilo-web-ui/theme"
import { LoadingScreen } from "./components/LoadingScreen"
import { ConsoleLayout } from "./layouts/ConsoleLayout"
import { path as route } from "./shared/navigation"

export default function App(props: { children?: JSX.Element }) {
  const loc = useLocation()
  const current = createMemo(() => route(loc.pathname))

  return (
    <ThemeProvider defaultTheme="kilo">
      <ConsoleLayout path={current()}>
        <Suspense fallback={<LoadingScreen variant="fullscreen" />}>{props.children}</Suspense>
      </ConsoleLayout>
    </ThemeProvider>
  )
}
