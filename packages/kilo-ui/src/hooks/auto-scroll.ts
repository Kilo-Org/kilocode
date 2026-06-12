export const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop

export const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > 1
