// kilocode_change: STT Microphone Settings
import { useEffect } from "react"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useSTT } from "@/hooks/useSTT"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { MicrophoneDevice } from "../../../../src/shared/sttContract"
import { RefreshCw } from "lucide-react"
import { Button } from "../ui/button"

export const STTSettings = () => {
	const { t } = useAppTranslation()
	const { devices, isLoadingDevices, loadDevices, selectDevice, selectedDevice } = useSTT()
	const extensionState = useExtensionState()
	const selectedMicrophoneDevice = extensionState?.selectedMicrophoneDevice

	const savedDevice = selectedMicrophoneDevice

	const handleDeviceChange = (value: string) => {
		if (value === "default") {
			selectDevice(null)
		} else {
			const device = devices.find((d) => d.id === value)
			if (device) {
				selectDevice(device)
			}
		}
	}

	const getCurrentDeviceValue = () => {
		// Prefer saved device from extension state, fallback to hook state
		const currentDevice = savedDevice !== undefined ? savedDevice : selectedDevice

		// If the current device is no longer available (e.g., device unplugged), fallback to default
		if (!currentDevice || !devices.some((device: MicrophoneDevice) => device.id === currentDevice.id)) {
			return "default"
		}

		return currentDevice.id
	}

	useEffect(() => {
		loadDevices()
	}, [loadDevices])

	return (
		<div className="space-y-3">
			<div>
				<label className="block font-medium mb-1">{t("kilocode:speechToText.microphone.label")}</label>
				<div className="flex gap-2">
					<VSCodeDropdown
						value={getCurrentDeviceValue()}
						onChange={(e: any) => handleDeviceChange(e.target.value)}
						className="flex-1"
						disabled={isLoadingDevices}>
						<VSCodeOption value="default" className="py-2 px-3">
							{t("kilocode:speechToText.microphone.defaultOption")}
						</VSCodeOption>
						{devices.map((device: MicrophoneDevice) => (
							<VSCodeOption key={device.id} value={device.id} className="py-2 px-3">
								{device.name}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
					<Button onClick={loadDevices} disabled={isLoadingDevices} className="flex items-center gap-2">
						<RefreshCw className={`w-4 h-4 ${isLoadingDevices ? "animate-spin" : ""}`} />
						{t("kilocode:speechToText.microphone.refresh")}
					</Button>
				</div>
				<p className="text-vscode-descriptionForeground text-xs mt-1">
					{t("kilocode:speechToText.microphone.description")}
				</p>
				{isLoadingDevices && (
					<p className="text-vscode-descriptionForeground text-xs mt-1">
						{t("kilocode:speechToText.microphone.loading")}
					</p>
				)}
				{!isLoadingDevices && devices.length === 0 && (
					<p className="text-vscode-descriptionForeground text-xs mt-1">
						{t("kilocode:speechToText.microphone.noDevices")}
					</p>
				)}
			</div>
		</div>
	)
}
