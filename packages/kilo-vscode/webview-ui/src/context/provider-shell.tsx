import { type ParentComponent } from "solid-js"
import { Base } from "./provider-base"
import { RichProvider } from "./rich-provider"
import { Session } from "./provider-session"
import { MemoryProvider } from "./memory"
import { FeedbackProvider } from "./feedback"

const Root: ParentComponent = (props) => <Base content={RichProvider}>{props.children}</Base>

const Chat: ParentComponent = (props) => (
  <MemoryProvider>
    <FeedbackProvider>{props.children}</FeedbackProvider>
  </MemoryProvider>
)

export const ProviderShell = { Root, Session, Chat }
