import type { Asset, AssetTypeHandler, TreeEntry } from './types'

/**
 * The only place that knows which asset types exist. UI tabs, filters, the
 * indexer and the import pipeline all read from here, so a new type (audio,
 * sprite, particle prefab…) is added by registering one handler.
 */
export class HandlerRegistry {
  private readonly handlers: AssetTypeHandler[] = []

  register(handler: AssetTypeHandler): this {
    if (this.handlers.some((h) => h.id === handler.id)) {
      throw new Error(`Asset handler "${handler.id}" is already registered`)
    }
    this.handlers.push(handler)
    return this
  }

  get(id: string): AssetTypeHandler | undefined {
    return this.handlers.find((h) => h.id === id)
  }

  /** Handlers in registration order. */
  all(): readonly AssetTypeHandler[] {
    return this.handlers
  }

  /** First handler (in registration order) that claims the entry. `.meta` files are never assets. */
  classify(entry: TreeEntry): AssetTypeHandler | undefined {
    if (entry.type !== 'blob' || entry.path.toLowerCase().endsWith('.meta')) return undefined
    return this.handlers.find((h) => h.match(entry))
  }

  collectAssets(entries: readonly TreeEntry[]): Asset[] {
    const assets: Asset[] = []
    for (const entry of entries) {
      const handler = this.classify(entry)
      if (!handler) continue
      assets.push({
        id: entry.path,
        type: handler.id,
        path: entry.path,
        name: baseName(entry.path),
        sha: entry.sha,
        size: entry.lfs ? (entry.lfsSize ?? entry.size) : entry.size,
        lfs: entry.lfs ?? false
      })
    }
    return assets
  }
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}
