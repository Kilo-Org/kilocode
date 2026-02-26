export function toggleAnswer(existing: string[], answer: string): string[] {
  const next = [...existing]
  const index = next.indexOf(answer)
  if (index === -1) next.push(answer)
  if (index !== -1) next.splice(index, 1)
  return next
}
