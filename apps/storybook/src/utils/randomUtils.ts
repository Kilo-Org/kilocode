import seedrandom from "seedrandom"

/**
 * Seeded random number generator for reproducible but varied timing
 * Used across storybook mock data to ensure consistent but realistic variations
 */
const rng = seedrandom("cline-messages-mock-data")

export const randomInterval = (min: number, max: number): number => {
	return Math.floor(rng() * (max - min + 1)) + min
}
