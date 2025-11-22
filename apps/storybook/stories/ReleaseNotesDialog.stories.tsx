import type { Meta, StoryObj } from "@storybook/react-vite"
import { ReleaseNotesDialog } from "@/components/release-notes/ReleaseNotesDialog"

const mockChangelog = `## [v4.106.0]

- [#2833](https://github.com/Kilo-Org/kilocode/pull/2833) [\`0b8ef46\`](https://github.com/Kilo-Org/kilocode/commit/0b8ef46) Thanks [@mcowger](https://github.com/mcowger)! - Preliminary support for native tool calling (a.k.a native function calling) was added

- [#3050](https://github.com/Kilo-Org/kilocode/pull/3050) [\`357d438\`](https://github.com/Kilo-Org/kilocode/commit/357d438) Thanks [@markijbema](https://github.com/markijbema)! - CMD-I now invokes the agent so you can give it more complex prompts

## [v4.105.0]

- [#3005](https://github.com/Kilo-Org/kilocode/pull/3005) [\`b87ae9c\`](https://github.com/Kilo-Org/kilocode/commit/b87ae9c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Improve the edit chat area to allow context and file drag and drop when editing messages
`

const meta = {
	title: "Views/Release Notes/ReleaseNotesDialog",
	component: ReleaseNotesDialog,
	argTypes: {
		isOpen: {
			control: { type: "boolean" },
		},
	},
	parameters: {
		disableChromaticDualThemeSnapshot: true,
	},
	args: {
		isOpen: true,
		onClose: () => console.log("Dialog closed"),
		markdown: mockChangelog,
	},
} satisfies Meta<typeof ReleaseNotesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
