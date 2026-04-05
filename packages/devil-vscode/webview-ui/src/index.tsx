/* @refresh reload */
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import App from "./App"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(() => <App />, root)
