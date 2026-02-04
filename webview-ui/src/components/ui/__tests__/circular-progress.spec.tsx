import { render, screen } from "@testing-library/react"
import { CircularProgress } from "../circular-progress"

describe("CircularProgress", () => {
	it("should render with default props", () => {
		render(<CircularProgress percentage={50} />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toBeInTheDocument()
		expect(svg).toHaveAttribute("aria-valuenow", "50")
		expect(svg).toHaveAttribute("aria-valuemin", "0")
		expect(svg).toHaveAttribute("aria-valuemax", "100")
	})

	it("should render with correct size", () => {
		render(<CircularProgress percentage={50} size={24} />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toHaveAttribute("width", "24")
		expect(svg).toHaveAttribute("height", "24")
	})

	it("should render with default size of 16", () => {
		render(<CircularProgress percentage={50} />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toHaveAttribute("width", "16")
		expect(svg).toHaveAttribute("height", "16")
	})

	it("should clamp percentage to 0 when negative", () => {
		render(<CircularProgress percentage={-10} />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toHaveAttribute("aria-valuenow", "0")
	})

	it("should clamp percentage to 100 when over 100", () => {
		render(<CircularProgress percentage={150} />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toHaveAttribute("aria-valuenow", "100")
	})

	it("should apply custom className", () => {
		render(<CircularProgress percentage={50} className="custom-class" />)

		const svg = screen.getByRole("progressbar")
		expect(svg).toHaveClass("custom-class")
		expect(svg).toHaveClass("shrink-0")
	})

	it("should render two circles (background and progress)", () => {
		render(<CircularProgress percentage={50} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		expect(circles).toHaveLength(2)
	})

	it("should have background circle with 0.2 opacity", () => {
		render(<CircularProgress percentage={50} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const backgroundCircle = circles[0]
		expect(backgroundCircle).toHaveAttribute("opacity", "0.2")
	})

	it("should render progress circle with correct stroke-dasharray", () => {
		render(<CircularProgress percentage={50} size={16} strokeWidth={2} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const progressCircle = circles[1]

		// With size=16 and strokeWidth=2, radius = (16-2)/2 = 7
		// circumference = 2 * PI * 7 ≈ 43.98
		const expectedCircumference = 2 * Math.PI * 7
		expect(progressCircle).toHaveAttribute("stroke-dasharray", expectedCircumference.toString())
	})

	it("should render at 0% with full offset", () => {
		render(<CircularProgress percentage={0} size={16} strokeWidth={2} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const progressCircle = circles[1]

		const radius = (16 - 2) / 2
		const circumference = 2 * Math.PI * radius
		// At 0%, offset should equal circumference (no progress shown)
		expect(progressCircle).toHaveAttribute("stroke-dashoffset", circumference.toString())
	})

	it("should render at 100% with zero offset", () => {
		render(<CircularProgress percentage={100} size={16} strokeWidth={2} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const progressCircle = circles[1]

		// At 100%, offset should be 0 (full circle shown)
		expect(progressCircle).toHaveAttribute("stroke-dashoffset", "0")
	})

	it("should have correct transform on progress circle", () => {
		render(<CircularProgress percentage={50} size={16} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const progressCircle = circles[1]

		// Progress should start from top (rotate -90deg from center)
		expect(progressCircle).toHaveAttribute("transform", "rotate(-90 8 8)")
	})

	it("should have round stroke linecap on progress circle", () => {
		render(<CircularProgress percentage={50} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")
		const progressCircle = circles[1]

		expect(progressCircle).toHaveAttribute("stroke-linecap", "round")
	})

	it("should apply custom stroke width", () => {
		render(<CircularProgress percentage={50} strokeWidth={4} />)

		const svg = screen.getByRole("progressbar")
		const circles = svg.querySelectorAll("circle")

		circles.forEach((circle) => {
			expect(circle).toHaveAttribute("stroke-width", "4")
		})
	})
})
