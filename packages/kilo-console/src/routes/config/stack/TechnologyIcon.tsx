import { dashboardIcon } from "./technology-icons"

const assets = import.meta.glob<string>("../../../assets/dashboard-icons/*.{png,svg}", {
  eager: true,
  query: "?url",
  import: "default",
})

export function TechnologyIcon(props: { id: string }) {
  const src = () => {
    const base = `../../../assets/dashboard-icons/${dashboardIcon(props.id)}`
    return assets[`${base}.png`] ?? assets[`${base}.svg`]
  }

  return (
    <span class="stack-technology-icon" aria-hidden="true">
      <img src={src()} alt="" />
    </span>
  )
}
