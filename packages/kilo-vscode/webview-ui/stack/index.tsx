import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/components/stack/stack.css"
import { StackApp } from "./StackApp"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(() => <StackApp />, root)
