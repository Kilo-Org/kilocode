import { vscode } from "@/utils/vscode"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const KiloShareSessionButton = ({ id }: { id: string }) => {
	const { t } = useAppTranslation()

	return (
		<Button
			variant="ghost"
			size="icon"
			title={t("history:shareSession")}
			data-testid="share-session-button"
			onClick={(e: React.MouseEvent) => {
				e.stopPropagation()
				vscode.postMessage({ type: "shareTaskSession", text: id })
			}}
			className="group-hover:opacity-100 opacity-50 transition-opacity">
			<span className="codicon codicon-link" />
		</Button>
	)
}
