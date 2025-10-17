// kilocode_change - new file: Storybook story for Release Notes Modal component
import type { Meta, StoryObj } from "@storybook/react-vite"
import { ReleaseNotesModal } from "@/components/release-notes/ReleaseNotesModal"
import { sampleReleaseNotes } from "./sampleReleaseNotes"

const meta = {
	title: "Components/ReleaseNotesModal",
	component: ReleaseNotesModal,
	argTypes: {
		isOpen: {
			control: { type: "boolean" },
		},
		loading: {
			control: { type: "boolean" },
		},
		currentVersion: {
			control: { type: "text" },
		},
	},
	parameters: {
		disableChromaticDualThemeSnapshot: true,
	},
	args: {
		isOpen: true,
		currentVersion: "4.106.0",
		releases: sampleReleaseNotes,
		loading: false,
		onClose: () => console.log("Modal closed"),
		onMarkAsViewed: (version: string) => console.log("Version marked as viewed:", version),
	},
} satisfies Meta<typeof ReleaseNotesModal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		releases: sampleReleaseNotes,
	},
}

export const SingleRelease: Story = {
	args: {
		releases: [sampleReleaseNotes[0]],
	},
}

export const UncategorizedChanges: Story = {
	args: {
		currentVersion: "4.104.0",
		releases: [sampleReleaseNotes[2]], // The one with only rawChanges
	},
}

export const Loading: Story = {
	args: {
		releases: [],
		loading: true,
	},
}

export const EmptyReleases: Story = {
	args: {
		releases: [],
		loading: false,
	},
}
