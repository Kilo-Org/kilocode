import { type Keys, type RooCodeSettings, GLOBAL_SETTINGS_KEYS, PROVIDER_SETTINGS_KEYS } from "@roo-code/types"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"

export const ROO_CODE_SETTINGS_KEYS = [
	...new Set([...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS]),
] as Keys<RooCodeSettings>[]

type SettingsDiffProps = {
	defaultSettings: RooCodeSettings
	customSettings: RooCodeSettings
}

export function SettingsDiff({
	customSettings: { experiments: customExperiments, ...customSettings },
	defaultSettings: { experiments: defaultExperiments, ...defaultSettings },
}: SettingsDiffProps) {
	const defaults = { ...defaultSettings, ...defaultExperiments }
	const custom = { ...customSettings, ...customExperiments }

	return (
		<div className="border rounded-sm">
			<Table>
				<TableHeader>
					<TableRow className="font-medium text-muted-foreground">
						<TableHead>Setting</TableHead>
						<TableHead>Default</TableHead>
						<TableHead>Custom</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ROO_CODE_SETTINGS_KEYS.map((key) => {
						const defaultValue = JSON.stringify(defaults[key as keyof typeof defaults], null, 2)
						const customValue = JSON.stringify(custom[key as keyof typeof custom], null, 2)

						return defaultValue === customValue ||
							(isEmpty(defaultValue) && isEmpty(customValue)) ? null : (
							<TableRow key={key}>
								<TableCell className="font-mono" title={key}>
									{key}
								</TableCell>
								<TableCell className="font-mono text-rose-500 line-through" title={defaultValue}>
									{defaultValue}
								</TableCell>
								<TableCell className="font-mono text-teal-500" title={customValue}>
									{customValue}
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}

const isEmpty = (value: string | undefined) =>
	value === undefined || value === "" || value === "null" || value === '""' || value === "[]" || value === "{}"
