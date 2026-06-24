import "@kilocode/kilo-web-ui/styles"
import { Router, Route } from "@solidjs/router"
import { render } from "solid-js/web"
import App from "./App"
import "./styles.css"
import { ProjectConsoleRoute } from "./routes/projects/ProjectConsoleRoute"
import { ProjectsRoute } from "./routes/projects/ProjectsRoute"
import { ProfileRoute } from "./routes/profile/ProfileRoute"
import { LoginRoute } from "./routes/profile/LoginRoute"
import { ConfigLayout } from "./layouts/ConfigLayout"
import { configRoutes, type ConfigScope } from "./routes/config/sections"

const root = document.getElementById("root")
if (!root) throw new Error("Missing root element")

const base = import.meta.env.BASE_URL.replace(/\/$/, "")

function routes(scope: ConfigScope) {
  return configRoutes(scope).map((item) => <Route path={item.path} component={item.component} />)
}

render(
  () => (
    <Router root={App} base={base || undefined}>
      <Route path="/projects" component={ProjectsRoute} />
      <Route path="/projects/:project" component={ProjectConsoleRoute} />
      <Route path="/projects/:project/settings" component={ConfigLayout}>
        {routes("project")}
      </Route>
      <Route path="/profile" component={ProfileRoute} />
      <Route path="/kilo/login" component={LoginRoute} />
      <Route path="/settings" component={ConfigLayout}>
        {routes("global")}
      </Route>
      <Route path="/config" component={ConfigLayout}>
        {routes("global")}
      </Route>
      <Route path="*" component={ProjectsRoute} />
    </Router>
  ),
  root,
)
