import { baseName } from '../registry'
import { parseTmpFont } from '../unity/tmpFont'
import type { DepContext } from './fbx'
import { resolveSelf } from './self'
import type { DependencyReport, PartRef } from './types'

/**
 * A TextMeshPro font asset: itself (its atlas and material live inside it),
 * the font assets it falls back to, and — when it is dynamic, adding glyphs
 * at run time — the font file it was made from.
 */
export async function resolveTmpFontDependencies(path: string, ctx: DepContext): Promise<DependencyReport> {
  const report = await resolveSelf(path, ctx)
  const info = parseTmpFont((await ctx.readTexts([path])).get(path) ?? '')
  if (!info) return report
  const guids = [...new Set([...(info.dynamic && info.sourceFont ? [info.sourceFont] : []), ...info.fallbacks])]
  if (!guids.length) return report
  await ctx.prepare?.(guids, 'other')
  const files = new Set(report.files)
  const parts: PartRef[] = guids.map((guid) => {
    const p = ctx.pathForGuid(guid)
    if (p) {
      files.add(p)
      if (ctx.byPath.has(`${p}.meta`)) files.add(`${p}.meta`)
    }
    const entry = p ? ctx.byPath.get(p) : undefined
    return { kind: 'other', guid, name: p ? baseName(p) : guid.slice(0, 8), path: p, missing: !p, size: entry?.size, uses: 1 }
  })
  return { ...report, files: [...files], parts }
}
