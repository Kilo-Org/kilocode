export const isControl = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false
  const editable = target.closest<HTMLElement>("[contenteditable]")
  return !!target.closest("button, input, textarea, select") || !!editable?.isContentEditable
}
