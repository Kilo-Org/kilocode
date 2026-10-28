import type { Interface, Resolved } from "../../../tui/src/config"
import { ConfigProvider, useConfig } from "../../../tui/src/config"
import { ThemeProvider, useTheme, useThemes, type ThemeSource } from "../../../tui/src/context/theme"
import { Logo } from "../../../tui/src/component/logo"
import { testRender } from "@opentui/solid"

export async function mount(config: Resolved, service: Interface, source: ThemeSource) {
  let themes!: ReturnType<typeof useThemes>
  let settings!: ReturnType<typeof useConfig>
  function View() {
    themes = useThemes()
    settings = useConfig()
    const theme = useTheme()
    return (
      <box flexDirection="column" backgroundColor={theme.background.base}>
        <text fg={theme.text.base}>Theme text</text>
        <text fg={theme.text.action.primary.base} bg={theme.background.action.primary.base}>
          Primary action
        </text>
        <text fg={theme.text.formfield.selected} bg={theme.background.formfield.selected}>
          Selected field
        </text>
        <text fg={theme.text.feedback.error.base}>Error feedback</text>
        <text fg={theme.markdown.link}>Markdown link</text>
        <Logo />
      </box>
    )
  }
  const app = await testRender(
    () => (
      <ConfigProvider config={config} service={service}>
        <ThemeProvider mode="dark" source={source}>
          <View />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 80, height: 16 },
  )
  app.renderer.start()
  await app.waitForFrame(() => themes?.ready === true)
  return { app, themes, settings }
}
