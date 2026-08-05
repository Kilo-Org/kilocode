import { plugin } from "bun"

plugin({
  name: "worker-url",
  setup(build) {
    build.onLoad({ filter: /\?worker&url$/ }, () => ({
      contents: "export default 'test-worker.js'",
      loader: "js",
    }))
  },
})
