import type { Meta, StoryObj } from "@storybook/react-vite"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const meta = {
	title: "Components/Tabs",
	component: Tabs,
	parameters: {
		layout: "centered",
	},
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => (
		<Tabs defaultValue="account" className="w-[400px]">
			<TabsList className="grid w-full grid-cols-2">
				<TabsTrigger value="account">Account</TabsTrigger>
				<TabsTrigger value="password">Password</TabsTrigger>
			</TabsList>
			<TabsContent value="account">
				<div className="space-y-4 pt-4">
					<h3 className="text-sm font-medium">Account Settings</h3>
					<p className="text-sm text-vscode-descriptionForeground">
						Make changes to your account here. Click save when you're done.
					</p>
				</div>
			</TabsContent>
			<TabsContent value="password">
				<div className="space-y-4 pt-4">
					<h3 className="text-sm font-medium">Password Settings</h3>
					<p className="text-sm text-vscode-descriptionForeground">
						Change your password here. After saving, you'll be logged out.
					</p>
				</div>
			</TabsContent>
		</Tabs>
	),
}
