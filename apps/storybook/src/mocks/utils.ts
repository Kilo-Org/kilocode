// Mock utility functions that components might need

export const useCopyToClipboard = () => {
	return {
		copy: (text: string) => {
			console.log("Mock copy to clipboard:", text)
			return Promise.resolve()
		},
		isCopied: false,
	}
}

export const getHighlighter = () => {
	return Promise.resolve({
		codeToHtml: (code: string, options: any) => {
			return `<pre><code>${code}</code></pre>`
		},
	})
}

export const isLanguageLoaded = (language: string) => true

export const normalizeLanguage = (language: string) => language

export type ExtendedLanguage = string

export const useAppTranslation = () => {
	return {
		t: (key: string, options?: any) => key,
		i18n: {
			language: "en",
			changeLanguage: (lng: string) => Promise.resolve(),
		},
	}
}
