const nonText = new Set(["button", "checkbox", "file", "hidden", "image", "radio", "range", "reset", "submit"])

/** Whether an element owns editable text focus that should not be stolen. */
export const isTextControl = (el: Element | null): boolean => {
  if (!el) return false
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true
  if (el.tagName === "INPUT") return !nonText.has((el as HTMLInputElement).type.toLowerCase())
  return ("isContentEditable" in el && (el as HTMLElement).isContentEditable) || el.getAttribute("role") === "textbox"
}
