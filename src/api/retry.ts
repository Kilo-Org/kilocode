/**
 * A decorator that retries a function if it throws an error
 * @param maxRetries Maximum number of retries (default: 3)
 * @param delayMs Delay between retries in milliseconds (default: 1000)
 * @returns A decorator function
 */
export function withRetry(maxRetries = 3, delayMs = 1000) {
	return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value

		descriptor.value = async function (...args: any[]) {
			let retries = 0
			while (true) {
				try {
					return await originalMethod.apply(this, args)
				} catch (error: any) {
					retries++
					if (retries > maxRetries) {
						throw error
					}
					console.warn(`Retry attempt ${retries}/${maxRetries} after error: ${error.message}`)
					await new Promise((resolve) => setTimeout(resolve, delayMs))
				}
			}
		}

		return descriptor
	}
}
