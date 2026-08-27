export function edge(
  event: Pick<MouseEvent, "screenX" | "clientX">,
  view: Pick<Window, "screenX" | "outerWidth" | "innerWidth">,
): "left" | "right" | undefined {
  const center = event.screenX - view.screenX - event.clientX + view.innerWidth / 2
  if (!Number.isFinite(center) || !Number.isFinite(view.outerWidth)) return
  if (view.outerWidth <= 0 || view.innerWidth <= 0 || center < 0 || center > view.outerWidth) return
  return center < view.outerWidth / 2 ? "left" : "right"
}
