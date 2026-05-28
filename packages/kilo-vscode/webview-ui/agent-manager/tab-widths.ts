export function setTabWidths(frozen: boolean, root: ParentNode = document) {
  const list = root.querySelector(".am-tab-list")
  if (!(list instanceof HTMLElement)) return
  list.toggleAttribute("data-tab-widths-frozen", frozen)

  const tabs = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
  for (const tab of tabs) {
    if (frozen) {
      const width = tab.getBoundingClientRect().width
      tab.style.width = `${width}px`
      tab.style.minWidth = `${width}px`
      tab.style.flex = `0 0 ${width}px`
      tab.style.maxWidth = `${width}px`
      continue
    }
    tab.style.width = ""
    tab.style.minWidth = ""
    tab.style.flex = ""
    tab.style.maxWidth = ""
  }
}
