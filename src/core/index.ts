import { fbxHandler } from './handlers/fbx'
import { textureHandler } from './handlers/texture'
import { materialHandler } from './handlers/material'
import { audioHandler } from './handlers/audio'
import { prefabHandler } from './handlers/prefab'
import { animationHandler } from './handlers/animation'
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
export * from './deps/material'
export * from './deps/self'
export * from './deps/prefab'
export * from './unity/prefabScene'
export * from './unity/animClip'
export * from './deps/anim'
export * from './image/psd'
export * from './audio/header'
export * from './search/search'

/** Registry with every built-in asset type. Add new handlers here. */
export function createDefaultRegistry(): HandlerRegistry {
  return new HandlerRegistry().register(fbxHandler).register(textureHandler).register(materialHandler).register(audioHandler).register(prefabHandler).register(animationHandler)
}
export * from './catalog/catalog'
export * from './checks/playable'
