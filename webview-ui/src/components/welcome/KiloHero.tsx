// kilocode_change - new file
import { useState } from "react"

const KiloHero = () => {
	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			className="mb-6 flex flex-col items-center justify-center py-8"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}>
			<div
				className="transition-transform duration-300 ease-in-out"
				style={{
					transform: isHovered ? "scale(1.05)" : "scale(1)",
				}}>
				<svg
					id="Kilo_Code_Branding"
					xmlns="http://www.w3.org/2000/svg"
					version="1.1"
					viewBox="0 0 50 50"
					className="w-24 h-24"
					style={{
						filter: isHovered ? "drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15))" : "none",
						transition: "filter 0.3s ease-in-out",
					}}>
					<path
						fill="var(--vscode-foreground)"
						d="M0,0v50h50V0H0ZM46.2962963,46.2962963H3.7037037V3.7037037h42.5925926v42.5925926ZM30.5555522,35.9548042h4.6296296v3.7037037h-5.8201058l-2.5132275-2.5132275v-5.8201058h3.7037037v4.6296296ZM38.8888855,35.9548042h-3.7037037v-4.6296296h-4.6296296v-3.7037037h5.8201058l2.5132275,2.5132275v5.8201058ZM23.1481481,30.5557103h-3.7037037v-3.7037037h3.7037037v3.7037037ZM11.1111111,26.8520066h3.7037037v8.3333333h8.3333333v3.7037037h-9.5238095l-2.5132275-2.5132275v-9.5238095ZM38.8888855,19.4444444v3.7037037h-12.037037v-3.7037037h4.1390959v-4.6296296h-4.1390959v-3.7037037h5.3295721l2.5132275,2.5132275v5.8201058h4.1942374ZM14.8148148,15.2777778h4.6296296l3.7037037,3.7037037v4.1666667h-3.7037037v-4.1666667h-4.6296296v4.1666667h-3.7037037v-12.037037h3.7037037v4.1666667ZM23.1481481,15.2777778h-3.7037037v-4.1666667h3.7037037v4.1666667Z"
					/>
				</svg>
			</div>
		</div>
	)
}

export default KiloHero
