import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FolderGit2 } from "lucide-react"

import { Package } from "@roo/package"

import { cn } from "@/lib/utils"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type GitProvidersProps = HTMLAttributes<HTMLDivElement> & {}

export const GitProviders = ({ className, ...props }: GitProvidersProps) => {
	const { t } = useAppTranslation()

	// const [kiloCodeBloat, setKiloCodeBloat] = useState<number[][]>([])

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader
				description={
					Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`
				}>
				<div className="flex items-center gap-2">
					<FolderGit2 className="w-4" />
					<div>{t("settings:sections.gitProviders")}</div>
				</div>
			</SectionHeader>

			<Section></Section>
		</div>
	)
}
