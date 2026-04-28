declare module "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js" {
  export const version: string
  export let disableWorker: boolean

  export function getDocument(data: Buffer): Promise<{
    numPages: number
    getPage(page: number): Promise<{
      getTextContent(opts: {
        normalizeWhitespace: boolean
        disableCombineTextItems: boolean
      }): Promise<{
        items: Array<{ str: string; transform: number[] }>
      }>
    }>
    destroy(): void
  }>
}
