import { describe, expect, it } from 'vitest'
import { SourceError } from '../errors'
import type { TreeEntry } from '../types'
import { GitHubClient, nextLink, type FetchLike } from './client'
import { isLfsPath, parseLfsAttributes, parseLfsPointer } from './lfs'
import { createDefaultRegistry } from '../index'
import { GitHubAssetSource, type CommitCache } from './source'

type Route = (url: string, body?: string, headers?: Record<string, string>) => { status?: number; json?: unknown; bytes?: string; headers?: Record<string, string> }

function fakeFetch(route: Route): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const r = route(url, init?.body, init?.headers)
    const status = r.status ?? 200
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
      arrayBuffer: async () => new TextEncoder().encode(r.bytes ?? '').buffer as ArrayBuffer
    }
  }
  return { fetch, calls }
}

const POINTER = (size: number) =>
  `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`

describe('LFS helpers', () => {
  it('parses pointers', () => {
    expect(parseLfsPointer(POINTER(123))).toEqual({ oid: 'a'.repeat(64), size: 123 })
    expect(parseLfsPointer('Kaydara FBX Binary')).toBeUndefined()
  })

  it('matches .gitattributes patterns like git', () => {
    const rules = parseLfsAttributes(
      ['# comment', '*.fbx filter=lfs diff=lfs merge=lfs -text', '*.[pP][nN][gG] filter=lfs', 'Assets/Raw/** filter=lfs', '/Assets/Raw/keep.txt -filter', '*.cs text'].join('\n')
    )
    expect(isLfsPath('Assets/Art/Hero.fbx', rules)).toBe(true)
    expect(isLfsPath('Hero.fbx', rules)).toBe(true)
    expect(isLfsPath('Assets/Art/Hero.FBX', rules)).toBe(false)
    expect(isLfsPath('a/b/Tex.PNG', rules)).toBe(true)
    expect(isLfsPath('Assets/Raw/x/y.bin', rules)).toBe(true)
    expect(isLfsPath('Assets/Raw/keep.txt', rules)).toBe(false)
    expect(isLfsPath('Assets/Scripts/A.cs', rules)).toBe(false)
  })
})

describe('GitHubClient', () => {
  it('follows Link pagination', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('page=2')
        ? { json: [{ full_name: 'o/b', default_branch: 'dev' }] }
        : { json: [{ full_name: 'o/a', default_branch: 'main' }], headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } }
    )
    const repos = await new GitHubClient('t', fetch).listRepos()
    expect(repos).toEqual([
      { fullName: 'o/a', defaultBranch: 'main' },
      { fullName: 'o/b', defaultBranch: 'dev' }
    ])
    expect(calls).toHaveLength(2)
  })

  it('encodes branch names containing slashes per segment', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { object: { sha: 'c1' } } }))
    expect(await new GitHubClient('t', fetch).getBranchHead('org/repo', 'vn/net catch')).toBe('c1')
    expect(calls[0]).toBe('GET https://api.github.com/repos/org/repo/git/ref/heads/vn/net%20catch')
  })

  it('maps HTTP failures to error codes', async () => {
    const cases: Array<[ReturnType<Route>, string]> = [
      [{ status: 401, json: { message: 'Bad credentials' } }, 'unauthorized'],
      [{ status: 403, json: {}, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/o/sso?x=1' } }, 'sso'],
      [{ status: 403, json: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' } }, 'rateLimited'],
      [{ status: 403, json: {} }, 'forbidden'],
      [{ status: 404, json: {} }, 'notFound'],
      [{ status: 500, json: {} }, 'unknown']
    ]
    for (const [response, code] of cases) {
      const { fetch } = fakeFetch(() => response)
      const err = await new GitHubClient('t', fetch).getUser().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SourceError)
      expect((err as SourceError).code).toBe(code)
    }
    const { fetch } = fakeFetch(() => ({ status: 403, json: {}, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/o/sso?x=1' } }))
    const sso = (await new GitHubClient('t', fetch).getUser().catch((e: unknown) => e)) as SourceError
    expect(sso.detail.ssoUrl).toBe('https://github.com/orgs/o/sso?x=1')
  })

  it('reports network failures', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(new GitHubClient('t', fetch).getUser()).rejects.toMatchObject({ code: 'network' })
  })

  it('batches blob reads through GraphQL', async () => {
    const { fetch, calls } = fakeFetch((_url, body) => {
      const query = JSON.parse(body!).query as string
      const aliases = [...query.matchAll(/(f\d+): object/g)].map((m) => m[1])
      return { json: { data: { repository: Object.fromEntries(aliases.map((a) => [a, { text: `text-${a}` }])) } } }
    })
    const paths = Array.from({ length: 120 }, (_, i) => `p${i}.fbx`)
    const texts = await new GitHubClient('t', fetch).getBlobTexts('o/r', 'c1', paths)
    expect(calls).toHaveLength(3)
    expect(texts.size).toBe(120)
  })

  it('splits and retries a batch on gateway timeouts', async () => {
    let failures = 2
    const { fetch, calls } = fakeFetch((_url, body) => {
      if (failures-- > 0) return { status: 504, json: {} }
      const query = JSON.parse(body!).query as string
      const aliases = [...query.matchAll(/(f\d+): object/g)].map((m) => m[1])
      return { json: { data: { repository: Object.fromEntries(aliases.map((a) => [a, { text: a }])) } } }
    })
    const texts = await new GitHubClient('t', fetch).getBlobTexts('o/r', 'c1', Array.from({ length: 30 }, (_, i) => `p${i}`))
    expect(texts.size).toBe(30)
    expect(calls.length).toBeGreaterThan(2)
  }, 20000)

  it('does not retry permanent errors', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 401, json: { message: 'Bad credentials' } }))
    await expect(new GitHubClient('t', fetch).getBlobTexts('o/r', 'c1', ['a'])).rejects.toMatchObject({ code: 'unauthorized' })
    expect(calls).toHaveLength(1)
  })

  it('parses next links', () => {
    expect(nextLink(null)).toBeUndefined()
    expect(nextLink('<https://x/1>; rel="prev", <https://x/3>; rel="next"')).toBe('https://x/3')
  })
})

describe('GitHubAssetSource', () => {
  const tree = [
    { path: '.gitattributes', type: 'blob', sha: 's0', size: 60 },
    { path: 'Assets', type: 'tree', sha: 't1' },
    { path: 'Assets/Hero.fbx', type: 'blob', sha: 's1', size: 131 },
    { path: 'Assets/Big.fbx', type: 'blob', sha: 's2', size: 900_000 },
    { path: 'Assets/Hero.png', type: 'blob', sha: 's3', size: 130 },
    { path: 'Sub', type: 'commit', sha: 'c9' }
  ]

  function source(truncated = false, cache?: CommitCache, gitFallback?: () => Promise<TreeEntry[]>) {
    const { fetch, calls } = fakeFetch((url, body) => {
      if (url.includes('/git/ref/heads/')) return { json: { object: { sha: 'commit1' } } }
      if (url.includes('/git/trees/')) return { json: { truncated, tree } }
      if (url.endsWith('/graphql')) {
        const query = JSON.parse(body!).query as string
        const repository: Record<string, { text: string }> = {}
        for (const m of query.matchAll(/(f\d+): object\(expression: "commit1:([^"]+)"\)/g)) {
          repository[m[1]] = { text: m[2] === '.gitattributes' ? '*.fbx filter=lfs\n*.png filter=lfs\n' : POINTER(5_000_000) }
        }
        return { json: { data: { repository } } }
      }
      return { status: 404, json: {} }
    })
    const src = new GitHubAssetSource(new GitHubClient('t', fetch), {
      shouldResolveLfs: (e) => e.path.endsWith('.fbx'),
      cache,
      gitFallback
    })
    return { src, calls }
  }

  it('marks LFS files, resolves real sizes for assets and drops submodules', async () => {
    const entries = await source().src.listTree('o/r', 'main')
    const byPath = new Map(entries.map((e) => [e.path, e]))
    expect(byPath.has('Sub')).toBe(false)
    expect(byPath.get('Assets/Hero.fbx')).toMatchObject({ lfs: true, lfsSize: 5_000_000, lfsOid: 'a'.repeat(64) })
    expect(byPath.get('Assets/Big.fbx')?.lfs).toBe(false)
    expect(byPath.get('Assets/Hero.png')).toMatchObject({ lfs: true })
    expect(byPath.get('Assets/Hero.png')?.lfsSize).toBeUndefined()
  })

  it('serves repeat requests for the same commit from the cache', async () => {
    const store = new Map<string, unknown>()
    const cache: CommitCache = {
      get: async <T,>(k: string, r: string, c: string) => store.get(`${k}:${r}@${c}`) as T | undefined,
      set: async (k, r, c, v) => void store.set(`${k}:${r}@${c}`, v)
    }
    const { src, calls } = source(false, cache)
    await src.listTree('o/r', 'main')
    const before = calls.length
    await src.listTree('o/r', 'main')
    expect(calls.length - before).toBe(1) // only the branch head lookup
  })

  it('uses the git fallback for truncated trees, and errors without one', async () => {
    await expect(source(true).src.listTree('o/r', 'main')).rejects.toMatchObject({ code: 'truncated' })
    const fallback = async (): Promise<TreeEntry[]> => [{ path: 'Assets/From/Git.fbx', type: 'blob', sha: 'g1', size: 131 }]
    const entries = await source(true, undefined, fallback).src.listTree('o/r', 'main')
    expect(entries.map((e) => e.path)).toEqual(['Assets/From/Git.fbx'])
  })
})

describe('GitHubAssetSource file access', () => {
  const G = (n: number) => n.toString(16).padStart(32, '0')
  const tree = [
    { path: 'p/ProjectSettings/ProjectVersion.txt', type: 'blob', sha: 'pv', size: 20 },
    { path: 'p/Assets/Hero.fbx', type: 'blob', sha: 'fbxsha', size: 500 },
    { path: 'p/Assets/Hero.fbx.meta', type: 'blob', sha: 'm1', size: 400 },
    { path: 'p/Assets/M.mat', type: 'blob', sha: 'm2', size: 300 },
    { path: 'p/Assets/M.mat.meta', type: 'blob', sha: 'm3', size: 100 },
    { path: 'p/Assets/T.png', type: 'blob', sha: 'pngsha', size: 131 },
    { path: 'p/Assets/T.png.meta', type: 'blob', sha: 'm4', size: 100 },
    { path: '.gitattributes', type: 'blob', sha: 'ga', size: 30 }
  ]
  const texts: Record<string, string> = {
    '.gitattributes': '*.png filter=lfs\n',
    'p/Assets/Hero.fbx.meta': `guid: ${G(1)}\n  externalObjects:\n  - first:\n      type: UnityEngine:Material\n      name: M\n    second: {fileID: 2100000, guid: ${G(2)}, type: 2}\n  materials:\n    materialImportMode: 2\n`,
    'p/Assets/M.mat.meta': `guid: ${G(2)}\n`,
    'p/Assets/T.png.meta': `guid: ${G(3)}\n`,
    'p/Assets/M.mat': `  m_Name: M\n  m_Shader: {fileID: 4800000, guid: 933532a4fcc9baf4fa0491de14d08ed7, type: 3}\n    m_TexEnvs:\n    - _BaseMap:\n        m_Texture: {fileID: 2800000, guid: ${G(3)}, type: 3}\n    m_Floats: []\n`
  }
  function make() {
    const { fetch, calls } = fakeFetch((url, body, headers) => {
      if (url.includes('/git/ref/heads/')) return { json: { object: { sha: 'c1' } } }
      if (url.includes('/git/trees/')) return { json: { truncated: false, tree } }
      if (url.endsWith('/graphql')) {
        const query = JSON.parse(body!).query as string
        const repository: Record<string, { text: string } | null> = {}
        for (const m of query.matchAll(/(f\d+): object\(expression: "c1:([^"]+)"\)/g)) repository[m[1]] = m[2] in texts ? { text: texts[m[2]] } : null
        return { json: { data: { repository } } }
      }
      if (url.endsWith('/git/blobs/fbxsha')) return { bytes: 'Kaydara FBX Binary' }
      if (url.endsWith('/git/blobs/pngsha')) return { bytes: `version https://git-lfs.github.com/spec/v1\noid sha256:${'b'.repeat(64)}\nsize 9\n` }
      if (url.endsWith('/info/lfs/objects/batch')) {
        expect(headers?.Authorization).toMatch(/^Basic /)
        return { json: { objects: [{ actions: { download: { href: 'https://lfs.example/obj', header: { 'X-Sig': '1' } } } }] } }
      }
      if (url === 'https://lfs.example/obj') {
        expect(headers?.Authorization).toBeUndefined()
        return { bytes: 'PNGBYTES!' }
      }
      return { status: 404, json: {} }
    })
    const registry = createDefaultRegistry()
    const store = new Map<string, Uint8Array>()
    const src = new GitHubAssetSource(new GitHubClient('t', fetch), {
      shouldResolveLfs: () => false,
      handlerFor: (e) => registry.classify(e),
      blobCache: { get: async (k) => store.get(k), set: async (k, b) => void store.set(k, b) }
    })
    return { src, calls }
  }

  it('reads git blobs directly and LFS files through the batch API, then caches them', async () => {
    const { src, calls } = make()
    const dec = (b: Uint8Array) => new TextDecoder().decode(b)
    expect(dec(await src.readFile('o/r', 'main', 'p/Assets/Hero.fbx'))).toBe('Kaydara FBX Binary')
    expect(dec(await src.readFile('o/r', 'main', 'p/Assets/T.png'))).toBe('PNGBYTES!')
    const before = calls.length
    await src.readFile('o/r', 'main', 'p/Assets/T.png')
    expect(calls.length).toBe(before)
  })

  it('resolves an FBX through the GUID index', async () => {
    const { src } = make()
    await src.listTree('o/r', 'main')
    const progress: number[] = []
    const report = await src.resolve('o/r', 'main', 'p/Assets/Hero.fbx', 'p/', (p) => progress.push(p.done))
    expect(report.kind).toBe('A')
    expect(report.materials[0]).toMatchObject({ name: 'M', path: 'p/Assets/M.mat', shader: { label: 'Universal Render Pipeline/Lit' } })
    expect(report.materials[0].textures[0]).toMatchObject({ prop: '_BaseMap', path: 'p/Assets/T.png' })
    expect(progress.at(-1)).toBe(2) // material + texture metas; model metas are not indexed
  })

  it('finds files by name nearest to a path', async () => {
    const { src } = make()
    expect(await src.findByNames('o/r', 'main', ['t.PNG', 'nope.png'], 'p/Assets/Hero.fbx', 'p/')).toEqual({ 't.PNG': 'p/Assets/T.png', 'nope.png': null })
  })
})

describe('GUID index speed-ups', () => {
  const G = (n: number) => n.toString(16).padStart(32, '0')
  const metaTree = (shaOfB: string) => [
    { path: 'p/ProjectSettings/ProjectVersion.txt', type: 'blob', sha: 'pv', size: 20 },
    { path: 'p/Assets/Hero.fbx', type: 'blob', sha: 'fbx', size: 500 },
    { path: 'p/Assets/Hero.fbx.meta', type: 'blob', sha: 'fm', size: 200 },
    { path: 'p/Assets/A.png', type: 'blob', sha: 'a', size: 10 },
    { path: 'p/Assets/A.png.meta', type: 'blob', sha: 'ma', size: 10 },
    { path: 'p/Assets/B.png', type: 'blob', sha: 'b', size: 10 },
    { path: 'p/Assets/B.png.meta', type: 'blob', sha: shaOfB, size: 10 }
  ]
  const metaText: Record<string, string> = { ma: `guid: ${G(1)}\n`, mb1: `guid: ${G(2)}\n`, mb2: `guid: ${G(3)}\n` }

  function make(opts: { bulk?: boolean } = {}) {
    let commit = 'c1'
    let shaOfB = 'mb1'
    const graphqlPaths: string[] = []
    const { fetch } = fakeFetch((url, body) => {
      if (url.includes('/git/ref/heads/')) return { json: { object: { sha: commit } } }
      if (url.includes('/git/trees/')) return { json: { truncated: false, tree: metaTree(shaOfB) } }
      if (url.endsWith('/graphql')) {
        const query = JSON.parse(body!).query as string
        const repository: Record<string, { text: string } | null> = {}
        for (const m of query.matchAll(/(f\d+): object\(expression: "c\d:([^"]+)"\)/g)) {
          graphqlPaths.push(m[2])
          const sha = metaTree(shaOfB).find((e) => e.path === m[2])?.sha
          repository[m[1]] = sha && metaText[sha] ? { text: metaText[sha] } : m[2].endsWith('Hero.fbx.meta') ? { text: 'guid: ' + G(9) + '\n' } : null
        }
        return { json: { data: { repository } } }
      }
      if (url.endsWith('/git/blobs/fbx')) return { bytes: 'Kaydara FBX Binary' }
      return { status: 404, json: {} }
    })
    const store = new Map<string, unknown>()
    const bulkCalls: string[][] = []
    const registry = createDefaultRegistry()
    const src = new GitHubAssetSource(new GitHubClient('t', fetch), {
      shouldResolveLfs: () => false,
      handlerFor: (e) => registry.classify(e),
      cache: { get: async <T,>(k: string, r: string, c: string) => store.get(`${k}:${r}@${c}`) as T | undefined, set: async (k, r, c, v) => void store.set(`${k}:${r}@${c}`, v) },
      readBlobsBulk: opts.bulk
        ? async (_repo, oids) => {
            bulkCalls.push([...oids])
            return new Map(oids.filter((o) => metaText[o]).map((o) => [o, new TextEncoder().encode(metaText[o])]))
          }
        : undefined
    })
    return {
      src,
      graphqlPaths,
      bulkCalls,
      advance: () => {
        commit = 'c2'
        shaOfB = 'mb2'
      }
    }
  }

  it('reads metas with the bulk reader when available, not GraphQL', async () => {
    const t = make({ bulk: true })
    await t.src.listTree('o/r', 'main')
    await t.src.resolve('o/r', 'main', 'p/Assets/Hero.fbx', 'p/')
    expect(t.bulkCalls).toEqual([['ma', 'mb1']])
    expect(t.graphqlPaths).toEqual(['p/Assets/Hero.fbx.meta']) // only the model's own .meta
  })

  it('on a new commit only reads the .meta files that changed', async () => {
    const t = make()
    await t.src.listTree('o/r', 'main')
    await t.src.resolve('o/r', 'main', 'p/Assets/Hero.fbx', 'p/')
    t.graphqlPaths.length = 0
    t.advance()
    await t.src.listTree('o/r', 'main')
    await t.src.resolve('o/r', 'main', 'p/Assets/Hero.fbx', 'p/')
    expect(t.graphqlPaths.filter((p) => p !== 'p/Assets/Hero.fbx.meta')).toEqual(['p/Assets/B.png.meta'])
  })
})
