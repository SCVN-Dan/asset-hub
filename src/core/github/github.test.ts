import { describe, expect, it } from 'vitest'
import { SourceError } from '../errors'
import type { TreeEntry } from '../types'
import { GitHubClient, nextLink, type FetchLike } from './client'
import { isLfsPath, parseLfsAttributes, parseLfsPointer } from './lfs'
import { GitHubAssetSource, type TreeCache } from './source'

type Route = (url: string, body?: string) => { status?: number; json: unknown; headers?: Record<string, string> }

function fakeFetch(route: Route): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const r = route(url, init?.body)
    const status = r.status ?? 200
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
      json: async () => r.json,
      text: async () => JSON.stringify(r.json)
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

  function source(truncated = false, cache?: TreeCache, gitFallback?: () => Promise<TreeEntry[]>) {
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
    const store = new Map<string, TreeEntry[]>()
    const cache: TreeCache = {
      get: async (r, c) => store.get(`${r}@${c}`),
      set: async (r, c, e) => void store.set(`${r}@${c}`, e)
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
