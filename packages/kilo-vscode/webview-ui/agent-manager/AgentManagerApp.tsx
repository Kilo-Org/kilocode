// Agent Manager root component
// Reuses the sidebar's provider chain, bridges, and ChatView

import { Component } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { VSCodeProvider } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { ChatView } from "../src/components/chat"
import SessionList from "../src/components/history/SessionList"
import { Button } from "@kilocode/kilo-ui/button"
import { LanguageBridge, DataBridge } from "../src/App"
import "./agent-manager.css"

const AgentManagerContent: Component = () => {
  const session = useSession()

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
  }

  return (
    <div class="am-layout">
      <div class="am-sidebar">
        <div class="am-sidebar-header">AGENT MANAGER</div>
        <Button variant="primary" size="large" onClick={() => session.clearCurrentSession()}>
          + New Agent
        </Button>
        <div class="am-sessions-header">SESSIONS</div>
        <div class="am-list">
          <SessionList onSelectSession={handleSelectSession} />
        </div>
      </div>
      <div class="am-detail">
        <ChatView onSelectSession={handleSelectSession} />
      </div>
    </div>
  )
}

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <SessionProvider>
                          <DataBridge>
                            <AgentManagerContent />
                          </DataBridge>
                        </SessionProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
