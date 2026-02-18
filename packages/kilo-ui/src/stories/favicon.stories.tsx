/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Favicon } from "@opencode-ai/ui/favicon"

const meta: Meta = {
  title: "Components/Favicon",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "12px", "max-width": "400px" }}>
      <Favicon />
      <p style={{ "font-size": "14px", color: "var(--text-base)", margin: 0 }}>
        The <code>Favicon</code> component injects favicon and meta tags into the document <code>&lt;head&gt;</code>. It
        has no visible UI output in the page body.
      </p>
      <p style={{ "font-size": "13px", color: "var(--text-weak)", margin: 0 }}>
        Check the browser tab icon and the <code>&lt;head&gt;</code> of this preview to see the injected tags.
      </p>
      <div
        style={{
          "background-color": "var(--surface-base)",
          padding: "12px",
          "border-radius": "6px",
          "font-size": "12px",
          "font-family": "monospace",
          color: "var(--text-weak)",
        }}
      >
        {`<link rel="icon" type="image/png" href="/favicon-96x96-v3.png" sizes="96x96">`}
        <br />
        {`<link rel="shortcut icon" href="/favicon-v3.ico">`}
        <br />
        {`<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v3.png">`}
        <br />
        {`<link rel="manifest" href="/site.webmanifest">`}
        <br />
        {`<meta name="apple-mobile-web-app-title" content="Kilo">`}
      </div>
    </div>
  ),
}
