import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RepoCatalog } from '@core/index'
import type { GitHubAssetSource } from '@core/github/source'
import type { StatsSummary } from '@core/checks/playable'
import { CatalogService } from './catalog'
import { StatsStore, ThumbnailStore } from './caches'
import { exportIndex, importIndex, readManifest, INDEX_FOLDER } from './sharedIndex'

const TYPES = 'fbx,prefab'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const stat = (o: Partial<StatsSummary>): StatsSummary => ({ triangles: 10, vertices: 10, bones: 0, clips: 0, materials: 1, fileBytes: 1, textureBytes: 1, maxTextureSize: 1, source: 'thumb', ...o })

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'assethub-shared-'))
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

/** One app's stores in its own cache folder, with a source that only keeps facts. */
function machine(name: string) {
  const dir = join(tmp, name)
  const facts = new Map<string, Record<string, unknown>>()
  const shared = (kind: string, repo: string) => {
    const k = `${kind}:${repo}`
    if (!facts.has(k)) facts.set(k, {})
    return facts.get(k)!
  }
  const source = {
    sharedFacts: async (kind: string, repo: string) => shared(kind, repo),
    mergeSharedFacts: async (kind: string, repo: string, more: Record<string, unknown>) => {
      const known = shared(kind, repo)
      let n = 0
      for (const [k, v] of Object.entries(more)) if (!(k in known)) ((known[k] = v), n++)
      return n
    }
  } as unknown as GitHubAssetSource
  const catalog = new CatalogService(source, () => join(dir, 'catalog'), () => true, () => 'fbx', () => false, TYPES, () => {})
  return { dir, shared, source, catalog, stats: new StatsStore(() => dir), thumbs: new ThumbnailStore(() => dir) }
}

describe('shared index', () => {
  it('carries catalogs, facts, measurements and thumbnails from one app to another', async () => {
    const a = machine('a')
    const hero = RepoCatalog.empty('org/hero', TYPES)
    hero.setBranches([{ name: 'main', commit: 'c1' }], 'main', 1000)
    hero.addCommit('c1', [{ path: 'Fish.fbx', type: 'blob', sha: 'fish', size: 5 }])
    await a.catalog.merge(hero.toJSON())
    a.shared('prefabfx3', 'org/hero').p1 = 'fx'
    await a.stats.save('fish', stat({ triangles: 500 }))
    await a.thumbs.save('fish', PNG)

    const shared = join(tmp, 'drive', INDEX_FOLDER)
    const wrote = await exportIndex(shared, a, 'dan', TYPES)
    expect(wrote).toMatchObject({ commits: 1, facts: 1, stats: 1, thumbs: 1 })
    expect(await readManifest(shared)).toMatchObject({ format: 1, exportedBy: 'dan', types: TYPES, repos: [{ repo: 'org/hero', branches: 1, commits: 1 }] })

    const b = machine('b')
    expect(await importIndex(shared, b)).toEqual({ commits: 1, facts: 1, stats: 1, thumbs: 1 })
    expect((await b.catalog.list([], [])).map((x) => x.path)).toEqual(['Fish.fbx'])
    expect(b.shared('prefabfx3', 'org/hero')).toEqual({ p1: 'fx' })
    expect((await b.stats.all()).fish.triangles).toBe(500)
    expect((await b.thumbs.read('fish'))?.type).toBe('image/png')
    // Nothing new the second time.
    expect(await importIndex(shared, b)).toEqual({ commits: 0, facts: 0, stats: 0, thumbs: 0 })
  })

  it('keeps what an app measured itself, but takes newer effect cards', async () => {
    const a = machine('a')
    await a.stats.save('fx', stat({ particles: 50, fxThumb: 2 }))
    await a.thumbs.save('fx', PNG)
    const shared = join(tmp, 'drive', INDEX_FOLDER)
    await exportIndex(shared, a, 'dan', TYPES)

    const b = machine('b')
    await b.stats.save('fx', stat({ particles: 40, source: 'viewer' }))
    await b.thumbs.save('fx', 'data:image/webp;base64,UklGRg==')
    const got = await importIndex(shared, b)
    expect(got.thumbs).toBe(1)
    const kept = (await b.stats.all()).fx
    expect(kept).toMatchObject({ particles: 40, source: 'viewer', fxThumb: 2 })
    expect((await b.thumbs.read('fx'))?.type).toBe('image/png')
  })

  it('takes in what is already in the folder before writing, so nobody loses work', async () => {
    const shared = join(tmp, 'drive', INDEX_FOLDER)
    const a = machine('a')
    a.shared('metaguids', 'org/hero').m1 = 'g1'
    const ca = RepoCatalog.empty('org/hero', TYPES)
    ca.setBranches([{ name: 'main', commit: 'c1' }], 'main', 1000)
    await a.catalog.merge(ca.toJSON())
    await exportIndex(shared, a, 'a', TYPES)
    const b = machine('b')
    b.shared('metaguids', 'org/hero').m2 = 'g2'
    await b.catalog.merge(ca.toJSON())
    await exportIndex(shared, b, 'b', TYPES)
    const file = (await readdir(join(shared, 'facts', 'metaguids')))[0]
    expect(file).toBe('org__hero.json.gz')
    const c = machine('c')
    await importIndex(shared, c)
    expect(c.shared('metaguids', 'org/hero')).toEqual({ m1: 'g1', m2: 'g2' })
    expect(JSON.parse(await readFile(join(shared, 'manifest.json'), 'utf8')).exportedBy).toBe('b')
  })
})
