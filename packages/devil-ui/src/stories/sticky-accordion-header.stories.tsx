/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"

const meta: Meta = {
  title: "Components/StickyAccordionHeader",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Accordion defaultValue={["item-1"]} collapsible>
      <Accordion.Item value="item-1">
        <StickyAccordionHeader>
          <Accordion.Trigger>Section 1</Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>
          <div style={{ padding: "8px" }}>Content for section 1</div>
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-2">
        <StickyAccordionHeader>
          <Accordion.Trigger>Section 2</Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>
          <div style={{ padding: "8px" }}>Content for section 2</div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}

export const InScrollContainer: Story = {
  render: () => (
    <div style={{ height: "200px", overflow: "auto", border: "1px solid var(--border-base)" }}>
      <Accordion defaultValue={["item-1"]} collapsible>
        <Accordion.Item value="item-1">
          <StickyAccordionHeader>
            <Accordion.Trigger>Sticky Header 1</Accordion.Trigger>
          </StickyAccordionHeader>
          <Accordion.Content>
            <div style={{ padding: "8px" }}>
              {Array.from({ length: 10 }, (_, i) => (
                <p style={{ margin: "4px 0" }}>Line {i + 1} of content</p>
              ))}
            </div>
          </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="item-2">
          <StickyAccordionHeader>
            <Accordion.Trigger>Sticky Header 2</Accordion.Trigger>
          </StickyAccordionHeader>
          <Accordion.Content>
            <div style={{ padding: "8px" }}>
              {Array.from({ length: 10 }, (_, i) => (
                <p style={{ margin: "4px 0" }}>Line {i + 1} of content</p>
              ))}
            </div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </div>
  ),
}
