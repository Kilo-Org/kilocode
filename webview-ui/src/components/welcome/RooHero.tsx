import { useState } from "react"

const RooHero = () => {
	const [imagesBaseUri] = useState(() => {
		const w = window as any
		return w.IMAGES_BASE_URI || ""
	})
	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			className="mb-4 relative forced-color-adjust-none group flex flex-col items-center w-30 pt-4 overflow-clip"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}>
			<div
				style={{
					backgroundColor: "var(--vscode-foreground)",
					WebkitMaskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
					WebkitMaskRepeat: "no-repeat",
					WebkitMaskSize: "contain",
					maskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
					maskRepeat: "no-repeat",
					maskSize: "contain",
					animation: isHovered ? "smooth-bounce 1s ease-in-out infinite" : "none",
				}}
				className="z-5 mr-auto translate-y-0 transition-transform duration-500">
				<img src={imagesBaseUri + "/roo-logo.svg"} alt="Roo logo" className="h-8 opacity-0" />
			</div>
			<div
				className="w-[200%] -mt-0.25 h-0.5 overflow-hidden opacity-0 group-hover:opacity-70 transition-opacity duration-300"
				data-testid="roo-hero-ground">
				<div className="w-full border-b-1 group-hover:border-b-1 border-dashed border-vscode-foreground animate-ground-slide" />
			</div>
			<div className="z-4 bg-gradient-to-r from-transparent to-vscode-sideBar-background absolute top-0 right-0 bottom-0 w-10 opacity-100" />
			<div className="z-3 bg-gradient-to-l from-transparent to-vscode-sideBar-background absolute top-0 left-0 bottom-0 w-10 opacity-100" />
			<div className="bg-vscode-foreground/10 rounded-full size-10 z-1 absolute -bottom-4 animate-sun opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-[2px]" />
		</div>
	)
}

export default RooHero
