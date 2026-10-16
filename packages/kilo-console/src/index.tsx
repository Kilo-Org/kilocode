import "@kilocode/kilo-web-ui/styles"
import { Router, Route } from "@solidjs/router"
import { lazy } from "solid-js"
import { render } from "solid-js/web"
import App from "./App"
import "./styles.css"
import { ProjectsRoute } from "./routes/projects/ProjectsRoute"
import { configSections } from "./routes/config/sections"

const ProjectConsoleRoute = lazy(() =>
  import("./routes/projects/ProjectConsoleRoute").then((mod) => ({ default: mod.ProjectConsoleRoute })),
)
const ConfigLayout = lazy(() => import("./layouts/ConfigLayout").then((mod) => ({ default: mod.ConfigLayout })))
const ProfileRoute = lazy(() => import("./routes/profile/ProfileRoute").then((mod) => ({ default: mod.ProfileRoute })))
const LoginRoute = lazy(() => import("./routes/profile/LoginRoute").then((mod) => ({ default: mod.LoginRoute })))

const root = document.getElementById("root")
if (!root) throw new Error("Missing root element")

const base = import.meta.env.BASE_URL.replace(/\/$/, "")

function routes() {
  return configSections.map((item) => <Route path={item.path} component={item.component} />)
}

render(
  () => (
    <Router root={App} base={base || undefined}>
      <Route path="/projects" component={ProjectsRoute} />
      <Route path="/projects/:project" component={ProjectConsoleRoute} />
      <Route path="/projects/:project/settings" component={ConfigLayout}>
        {routes()}
      </Route>
      <Route path="/profile" component={ProfileRoute} />
      <Route path="/kilo/login" component={LoginRoute} />
      <Route path="/settings" component={ConfigLayout}>
        {routes()}
      </Route>
      <Route path="/config" component={ConfigLayout}>
        {routes()}
      </Route>
      <Route path="*" component={ProjectsRoute} />
    </Router>
  ),
  root,
)
