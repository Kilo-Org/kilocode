import inquirer from "inquirer"
import { loadConfig, saveConfig, CLIConfig } from "../config"
import openConfigFile from "../config/openConfig"
import wait from "../utils/wait"

export default async function authWizard() {
	const config = await loadConfig()
	let providerSpecificConfig: Record<string, string> = {}

	const providerOptions = [
		{ name: "Axon Code", value: "kilocode" },
		{ name: "zAI", value: "zai" },
		{ name: "Other", value: "other" },
	] as const
	type ProviderOption = (typeof providerOptions)[number]["value"]

	const { provider } = await inquirer.prompt<{ provider: ProviderOption; kilocodeToken: string }>([
		{
			type: "list",
			name: "provider",
			message: "Please select which provider you would like to use:",
			choices: providerOptions,
		},
	])

	switch (provider) {
		case "kilocode": {
			console.info(
				"\nPlease navigate to https://app.matterai.so and copy your API key from the bottom of the page!\n",
			)
			const { kilocodeToken } = await inquirer.prompt<{ kilocodeToken: string }>([
				{
					type: "password",
					name: "kilocodeToken",
					message: "API Key:",
				},
			])
			providerSpecificConfig = { kilocodeToken, kilocodeModel: "axon-code" }
			break
		}
	}

	const newConfig = {
		...config.config,
		providers: [
			{
				id: "default",
				provider,
				...providerSpecificConfig,
			},
		],
	}

	await saveConfig(newConfig as CLIConfig)
}
