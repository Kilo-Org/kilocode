export const isStartWithArabic = (text: string | undefined | null): boolean => {
	if (!text) return false
	const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
	const firstChar = text.trim().charAt(0)
	return arabicPattern.test(firstChar)
}
