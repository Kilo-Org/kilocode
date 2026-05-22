const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ulid(): string {
  const time = Date.now()
  const timeStr = encodeTime(time)
  const rand = Array.from({ length: 16 }, () => ENCODING[Math.floor(Math.random() * 32)]).join("")
  return timeStr + rand
}

function encodeTime(value: number): string {
  const chars: string[] = []
  for (let i = 0; i < 10; i++) {
    const shift = 45 - i * 5
    chars.push(ENCODING[Math.floor(value / 2 ** shift) % 32])
  }
  return chars.join("")
}
