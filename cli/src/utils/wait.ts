export default async function wait(t: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, t)
	})
}
