/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal } from "solid-js"
import { LineCommentAnchor, LineComment, LineCommentEditor } from "@opencode-ai/ui/line-comment"

const meta: Meta = {
  title: "Components/LineComment",
  decorators: [
    (Story) => (
      <div style={{ padding: "32px", position: "relative", "min-height": "120px" }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const AnchorClosed: Story = {
  render: () => (
    <LineCommentAnchor open={false} top={0}>
      <span>Comment content</span>
    </LineCommentAnchor>
  ),
}

export const AnchorOpen: Story = {
  render: () => (
    <LineCommentAnchor open top={0}>
      <div style={{ padding: "8px", "font-size": "13px", color: "var(--text-base)" }}>
        This is a comment inside the popover.
      </div>
    </LineCommentAnchor>
  ),
}

export const CommentDefault: Story = {
  render: () => (
    <LineComment
      open
      top={0}
      comment={<span>Looks good, but consider adding error handling here.</span>}
      selection={<span>line 42</span>}
    />
  ),
}

export const CommentClosed: Story = {
  render: () => (
    <LineComment
      open={false}
      top={0}
      comment={<span>This needs refactoring.</span>}
      selection={<span>lines 10–15</span>}
    />
  ),
}

export const EditorDefault: Story = {
  render: () => {
    const [value, setValue] = createSignal("")
    return (
      <LineCommentEditor
        top={0}
        value={value()}
        selection={<span>line 7</span>}
        onInput={setValue}
        onCancel={() => {}}
        onSubmit={() => {}}
        placeholder="Leave a comment..."
      />
    )
  },
}

export const EditorWithValue: Story = {
  render: () => {
    const [value, setValue] = createSignal("This function could be simplified using Array.reduce()")
    return (
      <LineCommentEditor
        top={0}
        value={value()}
        selection={<span>lines 23–31</span>}
        onInput={setValue}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    )
  },
}

export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false)
    const [value, setValue] = createSignal("")
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <p style={{ "font-size": "13px", color: "var(--text-weak)", margin: 0 }}>Click the comment icon to toggle</p>
        <LineCommentAnchor open={open()} top={0} onClick={() => setOpen((v) => !v)}>
          <div style={{ padding: "8px", "font-size": "13px" }}>{open() ? "Popover is open" : ""}</div>
        </LineCommentAnchor>
      </div>
    )
  },
}
