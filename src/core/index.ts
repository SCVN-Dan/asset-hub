import { fbxHandler } from './handlers/fbx'
import { HandlerRegistry } from './registry'

export * from './types'
export * from './registry'
export * from './tree'
export * from './format'
export * from './source'
export * from './errors'
export * from './unity'
export * from './unity/yaml'
export * from './deps/types'
export * from './deps/fbx'
export * from './image/psd'
export * from './search/search'

/** Registry with every built-in asset type. Add new handlers here. */
export function createDefaultRegistry(): HandlerRegistry {
  return new HandlerRegistry().register(fbxHandler)
}
export * from './catalog/catalog'
