import { atom } from "jotai"

export interface QueuedUserMessage {
	id: string
	text: string
	images?: string[]
	enqueuedAt: number
}

export const queuedUserMessagesAtom = atom<QueuedUserMessage[]>([])

export const clearOutgoingQueueSignalAtom = atom<number>(0)
export const clearStdinQueueSignalAtom = atom<number>(0)

export const requestClearOutgoingQueueAtom = atom(null, (get, set) => {
	set(queuedUserMessagesAtom, [])
	set(clearOutgoingQueueSignalAtom, get(clearOutgoingQueueSignalAtom) + 1)
})

export const requestClearStdinQueueAtom = atom(null, (get, set) => {
	set(clearStdinQueueSignalAtom, get(clearStdinQueueSignalAtom) + 1)
})

export const requestClearAllMessageQueuesAtom = atom(null, (get, set) => {
	set(requestClearOutgoingQueueAtom)
	set(requestClearStdinQueueAtom)
})
