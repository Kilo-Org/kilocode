export type CacheMetadata = {
  size: number
  mtimeMs: number
  ctimeMs: number
}

export interface ICacheManager {
  getHash(filePath: string): string | undefined
  getMetadata?(filePath: string): CacheMetadata | undefined
  updateHash(filePath: string, hash: string, metadata?: CacheMetadata): void
  deleteHash(filePath: string): void
  getAllHashes(): Record<string, string>
}
