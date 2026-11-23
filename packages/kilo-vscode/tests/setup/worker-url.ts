import { plugin } from "bun"
import "../../../ui/test/solid-jsx"

plugin({
  name: "worker-url",
  setup(build) {
    build.onLoad({ filter: /\?worker&url$/ }, () => ({
      contents: "export default 'test-worker.js'",
      loader: "js",
    }))
  },
})
