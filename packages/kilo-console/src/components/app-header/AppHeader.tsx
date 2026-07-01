import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { A } from "@solidjs/router"
import { OmniSearch } from "./OmniSearch"

export function AppHeader() {
  return (
    <header class="app-header">
      <A class="header-brand" href="/projects" aria-label="Kilo Console home">
        <img class="header-mark header-mark-logo" src={`${import.meta.env.BASE_URL}kilo-logo.svg`} alt="" width="28" height="28" />
        <span class="header-title">
          <span>Console</span>
        </span>
      </A>

      <OmniSearch />

      <nav class="notification-zone" aria-label="Notifications and status">
        <IconButton icon="bubble-5" variant="ghost" aria-label="Notifications" />
        <IconButton icon="help" variant="ghost" aria-label="Help" />
        <IconButton icon="circle-check" variant="ghost" aria-label="System status" />
      </nav>
    </header>
  )
}
