import type { JSX } from "solid-js"
import { AppHeader } from "../components/app-header/AppHeader"
import { AppSidebar } from "../components/app-sidebar/AppSidebar"
import type { Path } from "../shared/navigation"

type Props = {
  children: JSX.Element
  path: Path
}

export function ConsoleLayout(props: Props) {
  return (
    <div class="console-shell kilo-console dark">
      <AppHeader />
      <div class="console-body">
        <AppSidebar path={props.path} />
        <main class="console-main">{props.children}</main>
      </div>
    </div>
  )
}
