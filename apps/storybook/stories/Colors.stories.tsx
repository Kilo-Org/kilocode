import type { Meta, StoryObj } from "@storybook/react-vite"

interface ColorSampleProps {
	variable: string
}

const ColorSample = ({ variable }: ColorSampleProps) => (
	<tr>
		<td className="p-3 border-b border-[var(--vscode-widget-border)]">
			<div className="flex items-center gap-3">
				<div
					className="w-10 h-10 border border-[var(--vscode-widget-border)] rounded"
					style={{ backgroundColor: `var(${variable})` }}
				/>
				<span className="text-[var(--vscode-foreground)] font-mono text-sm font-semibold">{variable}</span>
			</div>
		</td>
	</tr>
)

const ColorPreviewTable = () => {
	const colorVariables = [
		"--vscode-editor-background",
		"--vscode-button-background",
		"--vscode-activityBar-background",
		"--vscode-statusBar-background",
		"--vscode-errorForeground",
		"--vscode-focusBorder",
	]

	return (
		<div className="p-5 text-[var(--vscode-foreground)]">
			<h2 className="text-lg font-semibold mb-5 text-[var(--vscode-foreground)]">VS Code Theme Colors</h2>
			<table className="w-full border-collapse bg-[var(--vscode-editorWidget-background)] border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
				<thead>
					<tr className="bg-[var(--vscode-sideBarSectionHeader-background)]">
						<th className="p-3 text-left text-[var(--vscode-sideBarSectionHeader-foreground)] text-sm font-semibold border-b border-[var(--vscode-sideBarSectionHeader-border)]">
							Color Variable
						</th>
					</tr>
				</thead>
				<tbody>
					{colorVariables.map((variable, index) => (
						<ColorSample key={index} variable={variable} />
					))}
				</tbody>
			</table>
		</div>
	)
}

const meta: Meta<typeof ColorPreviewTable> = {
	title: "System/Theme",
	component: ColorPreviewTable,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"A preview of VS Code theme colors that change between light and dark modes. Used for snapshot testing to verify theme switching functionality.",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof ColorPreviewTable>

export const ColorPreview: Story = {
	name: "Colors",
	parameters: {
		docs: {
			description: {
				story: "Displays VS Code color variables with their visual representation. The colors automatically adapt based on the current theme (light/dark mode).",
			},
		},
	},
}
