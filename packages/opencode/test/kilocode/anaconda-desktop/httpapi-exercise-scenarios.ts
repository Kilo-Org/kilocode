import { object } from "../../server/httpapi-exercise/assertions"
import { http } from "../../server/httpapi-exercise/dsl"
import type { Scenario } from "../../server/httpapi-exercise/types"

const root = "/kilocode/anaconda-desktop"
const invalid = (path: string) => `${path}?directory=one&directory=two`

export const anacondaDesktopScenarios: Scenario[] = [
  http.protected.get(`${root}/status`, "anacondaDesktop.status").json(200, object),
  http.protected
    .post(`${root}/open`, "anacondaDesktop.open")
    .at((ctx) => ({ path: invalid(`${root}/open`), headers: ctx.headers() }))
    .json(400, object),
  http.protected
    .post(`${root}/sync`, "anacondaDesktop.sync")
    .at((ctx) => ({ path: invalid(`${root}/sync`), headers: ctx.headers(), body: {} }))
    .json(400, object),
]
