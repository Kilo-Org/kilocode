import { dashboardIcon } from "./technology-icons"

const base = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI ?? ""

export function TechnologyIcon(props: { id: string }) {
  return (
    <span class="stack-technology-icon" aria-hidden="true">
      <img src={`${base}/dashboard/${dashboardIcon(props.id)}`} alt="" />
    </span>
  )
}
