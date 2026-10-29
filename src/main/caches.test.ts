import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CacheJanitor, FileBlobCache, FileCommitCache, ThumbnailStore } from './caches'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'assethub-cache-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('FileCommitCache', () => {
  it('stores listings gzipped and reads them back', async () => {
    const cache = new FileCommitCache(() => root)
    const tree = [{ path: 'Assets/A.fbx', sha: 'a' }]
    await cache.set('tree', 'org/repo', 'c1', tree)
    const file = join(root, 'tree', 'org__repo', 'c1.json.gz')
    expect(JSON.parse(gunzipSync(await readFile(file)).toString())).toEqual(tree)
    expect(await cache.get('tree', 'org/repo', 'c1')).toEqual(tree)
  })

  it('reads a plain .json from an earlier version and rewrites it compressed', async () => {
    await mkdir(join(root, 'tree', 'org__repo'), { recursive: true })
    await writeFile(join(root, 'tree', 'org__repo', 'c1.json'), JSON.stringify({ old: true }))
    const cache = new FileCommitCache(() => root)
    expect(await cache.get('tree', 'org/repo', 'c1')).toEqual({ old: true })
    expect(await readdir(join(root, 'tree', 'org__repo'))).toEqual(['c1.json.gz'])
  })

  it('reports what it writes, for the size limit', async () => {
    let written = 0
    await new FileCommitCache(() => root, (n) => (written += n)).set('guids', 'org/repo', 'c1', { a: 'b' })
    expect(written).toBeGreaterThan(0)
  })
})

describe('ThumbnailStore', () => {
  it('saves images as files and hands out URLs only for those that exist', async () => {
    const store = new ThumbnailStore(() => root)
    await store.save('sha1', PNG)
    const urls = await store.getMany(['sha1', 'sha2'])
    expect(Object.keys(urls)).toEqual(['sha1'])
    expect(urls.sha1).toMatch(/^assethub-thumb:\/\/t\/sha1\?v=\d+$/)
    const found = await store.read('sha1')
    expect(found?.type).toBe('image/png')
    expect(found?.bytes[0]).toBe(0x89)
  })

  it('serves and converts data-URL thumbnails of earlier versions', async () => {
    await mkdir(join(root, 'thumbs'), { recursive: true })
    await writeFile(join(root, 'thumbs', 'old.txt'), PNG)
    const store = new ThumbnailStore(() => root)
    expect(Object.keys(await store.getMany(['old']))).toEqual(['old'])
    expect((await store.read('old'))?.type).toBe('image/png')
    expect(await readdir(join(root, 'thumbs'))).toEqual(['old.img'])
  })

  it('changes the URL when a thumbnail is drawn again', async () => {
    const store = new ThumbnailStore(() => root)
    await store.save('sha1', PNG)
    const first = (await store.getMany(['sha1'])).sha1
    await new Promise((r) => setTimeout(r, 5))
    await store.save('sha1', PNG)
    expect((await store.getMany(['sha1'])).sha1).not.toBe(first)
  })

  it('refuses names outside the cache folder', async () => {
    expect(await new ThumbnailStore(() => root).read('../settings')).toBeUndefined()
  })
})

describe('CacheJanitor', () => {
  const put = async (rel: string, bytes: number, ageDays: number) => {
    const file = join(root, rel)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, Buffer.alloc(bytes))
    const t = new Date(Date.now() - ageDays * 86_400_000)
    await utimes(file, t, t)
  }

  it('removes the least recently used downloads until under the limit, never thumbnails', async () => {
    await put('blobs/aa/old', 400, 3)
    await put('tree/org__repo/c1.json.gz', 400, 2)
    await put('blobs/bb/new', 400, 0)
    await put('thumbs/x.img', 5000, 9)
    await new CacheJanitor(() => root, () => 700).prune()
    expect(await readdir(join(root, 'blobs', 'aa'))).toEqual([])
    expect(await readdir(join(root, 'tree', 'org__repo'))).toEqual([])
    expect(await readdir(join(root, 'blobs', 'bb'))).toEqual(['new'])
    expect(await readdir(join(root, 'thumbs'))).toEqual(['x.img'])
  })

  it('keeps everything without a limit', async () => {
    await put('blobs/aa/old', 400, 3)
    await new CacheJanitor(() => root, () => 0).prune()
    expect(await readdir(join(root, 'blobs', 'aa'))).toEqual(['old'])
  })

  it('cleans folders of older versions and temp files left by crashes', async () => {
    await put('prefabfx2/org__repo/x.json', 10, 0)
    await put('blobs/aa/f.1.2.tmp', 10, 1)
    await put('blobs/aa/g.1.3.tmp', 10, 0)
    await new CacheJanitor(() => root, () => 0).cleanStale()
    expect(await readdir(root)).not.toContain('prefabfx2')
    expect(await readdir(join(root, 'blobs', 'aa'))).toEqual(['g.1.3.tmp'])
  })

  it('measures downloads, thumbnails and the rest apart', async () => {
    await put('blobs/aa/f', 100, 0)
    await put('thumbs/x.img', 20, 0)
    await put('stats.json', 3, 0)
    expect(await new CacheJanitor(() => root, () => 0).usage()).toEqual({ downloads: 100, thumbs: 20, other: 3 })
  })

  it('clears downloads but keeps thumbnails and measurements', async () => {
    await put('blobs/aa/f', 100, 0)
    await put('thumbs/x.img', 20, 0)
    await put('stats.json', 3, 0)
    await new CacheJanitor(() => root, () => 0).clear()
    expect((await readdir(root)).sort()).toEqual(['stats.json', 'thumbs'])
  })

  it('blob reads mark files as used', async () => {
    await put('blobs/ke/key1', 10, 5)
    expect(await new FileBlobCache(() => root).get('key1')).toHaveLength(10)
    await new Promise((r) => setTimeout(r, 20))
    await put('blobs/ot/other', 10, 1)
    await new CacheJanitor(() => root, () => 15).prune()
    expect(await readdir(join(root, 'blobs', 'ke'))).toEqual(['key1'])
  })
})
