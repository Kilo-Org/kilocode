import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import { MarketplaceApp } from "./MarketplaceApp"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(() => <MarketplaceApp />, root)
