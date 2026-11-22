/** @jsxImportSource solid-js */
import { onMount } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DialogProvider, useDialog } from "@kilocode/kilo-ui/context/dialog"
import ProviderConnectDialog from "../components/settings/ProviderConnectDialog"
import ProviderSelectDialog from "../components/settings/ProviderSelectDialog"
import { ProviderContext, useProvider } from "../context/provider"
import { StoryProviders } from "./StoryProviders"

const meta: Meta = {
  title: "Settings/Ace Data Cloud",
  parameters: { layout: "fullscreen" },
}
export default meta

function Fixture(props: { picker?: boolean }) {
  const provider = useProvider()
  const value = {
    ...provider,
    providers: () => ({
      ...provider.providers(),
      acedatacloud: { id: "acedatacloud", name: "Ace Data Cloud", models: {} },
    }),
  }
  return (
    <ProviderContext.Provider value={value}>
      <DialogProvider>
        <Connection picker={props.picker} />
      </DialogProvider>
    </ProviderContext.Provider>
  )
}

function Connection(props: { picker?: boolean }) {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => (props.picker ? <ProviderSelectDialog /> : <ProviderConnectDialog providerID="acedatacloud" />)),
  )
  return null
}

/** Catalog presence is a fixture; Models.dev admission remains a separate prerequisite. */
export const ApiKey: StoryObj = {
  name: "Catalog provider — API key connection",
  render: () => (
    <StoryProviders>
      <Fixture />
    </StoryProviders>
  ),
}

export const Picker: StoryObj = {
  name: "Catalog provider — selection",
  render: () => (
    <StoryProviders>
      <Fixture picker />
    </StoryProviders>
  ),
}
