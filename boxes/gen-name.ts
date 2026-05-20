const ADJ = [
  "brave", "calm", "clever", "cosmic", "crisp", "curious", "eager",
  "gentle", "glowing", "happy", "hidden", "jolly", "kind", "lucky",
  "mighty", "misty", "neon", "nimble", "playful", "proud", "quick",
  "quiet", "shiny", "silent", "stellar", "sunny", "swift", "tidy", "witty",
] as const

const NOUN = [
  "cabin", "cactus", "canyon", "circuit", "comet", "eagle", "engine",
  "falcon", "forest", "garden", "harbor", "island", "knight", "lagoon",
  "meadow", "moon", "mountain", "nebula", "orchid", "otter", "panda",
  "pixel", "planet", "river", "rocket", "sailor", "squid", "star",
  "tiger", "wizard", "wolf",
] as const

const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]

export function genName(): string {
  return `${pick(ADJ)}-${pick(NOUN)}`
}
