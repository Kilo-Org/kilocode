export const generateMessage = () => {
	const now = Date.now()
	const uniqueSuffix = Math.floor(Math.random() * 10000)
	return {
		id: `msg-${now}-${uniqueSuffix}`,
		ts: now,
	}
}
