import { type ParentComponent } from "solid-js"
import { Base } from "./provider-base"
import { RichProvider } from "./rich-provider"
import { Session } from "./provider-session"

const Root: ParentComponent = (props) => <Base content={RichProvider}>{props.children}</Base>

export const ProviderShell = { Root, Session }
