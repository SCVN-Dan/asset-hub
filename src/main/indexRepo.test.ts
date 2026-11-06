import { execFileSync } from 'child_process'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RepoCatalog } from '@core/index'
import type { GitHubAssetSource } from '@core/github/source'
import type { SharedIndexStatus } from '@shared/ipc'
import { CatalogService } from './catalog'
import { StatsStore, ThumbnailStore } from './caches'
import { IndexRepo } from './indexRepo'
import { SharedIndexService } from './sharedIndex'

const TYPES = 'fbx,prefab'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let tmp: string
let remote: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'assethub-indexrepo-'))
  // The "GitHub" repo: bare, with a README on main, as `gh repo create --add-readme` makes it.
  remote = join(tmp, 'remote.git')
  execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', remote])
  const seed = join(tmp, 'seed')
  execFileSync('git', ['clone', '--quiet', remote, seed], { stdio: 'pipe' })
  execFileSync('sh', ['-c', 'echo index > README.md && git add . && git -c user.name=t -c user.email=t@t commit -qm init && git push -q origin HEAD:main'], { cwd: seed })
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

function machine(name: string, login: string) {
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
  const deps = { catalog, source, stats: new StatsStore(() => dir), thumbs: new ThumbnailStore(() => dir) }
  const repo = new IndexRepo(join(dir, 'shared-index-repo'), () => 'token', 'org/index', remote)
  let status: SharedIndexStatus | undefined
  const service = new SharedIndexService(deps, () => undefined, () => join(dir, 'shared-index.json'), TYPES, login, (s) => (status = s), repo)
  const addRepo = async (name: string, commit: string, file: string) => {
    const c = RepoCatalog.empty(name, TYPES)
    c.setBranches([{ name: 'main', commit }], 'main', 1000)
    c.addCommit(commit, [{ path: file, type: 'blob', sha: file, size: 5 }])
    await catalog.merge(c.toJSON())
  }
  return { ...deps, service, addRepo, status: () => status }
}

/** Status reaches listeners after the work's promise settles. */
const settle = () => new Promise((r) => setTimeout(r, 50))
const commits = () => Number(execFileSync('git', ['rev-list', '--count', 'main'], { cwd: remote }).toString())
const files = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort()

describe('shared index on GitHub', () => {
  it('two apps writing at the same time both end up in it, nothing lost', async () => {
    const a = machine('a', 'ann')
    const b = machine('b', 'bob')
    await a.addRepo('org/hero', 'c1', 'Fish.fbx')
    await a.thumbs.save('fish', PNG)
    await b.addRepo('org/snake', 's1', 'Snake.fbx')
    await b.thumbs.save('snake', PNG)
    // Both start from the same commit; whoever pushes second is refused, pulls, takes in and writes again.
    await Promise.all([a.service.exportNow(), b.service.exportNow()])
    await settle()
    expect(a.status()?.state).toBe('idle')
    expect(b.status()?.state).toBe('idle')

    const c = machine('c', 'cat')
    await c.service.check()
    expect((await c.catalog.snapshot()).map((x) => x.repo).sort()).toEqual(['org/hero', 'org/snake'])
    expect(await c.thumbs.names()).toEqual(expect.arrayContaining(['fish', 'snake']))
    // README, then one commit each: the second was refused once, rebuilt on the first and pushed.
    expect(sh(remote, 'log', '--format=%s', 'main').split('\n').sort()).toEqual(['Write index (ann)', 'Write index (bob)', 'init'])
  })

  it('writes nothing when it has nothing new, and leaves personal repos out', async () => {
    const a = machine('a', 'ann')
    await a.addRepo('org/hero', 'c1', 'Fish.fbx')
    await a.addRepo('ann/sandbox', 'p1', 'Mine.fbx')
    await a.service.exportNow()
    const after = commits()
    await a.service.exportNow()
    expect(commits()).toBe(after)

    const b = machine('b', 'bob')
    await b.service.check()
    expect((await b.catalog.snapshot()).map((x) => x.repo)).toEqual(['org/hero'])
    expect(await files(join(tmp, 'b', 'shared-index-repo', 'catalog'))).toEqual(['org__hero.json.gz'])
  })

  it('contributes on its own when the shared index is missing, then waits', async () => {
    const a = machine('a', 'ann')
    await a.addRepo('org/hero', 'c1', 'Fish.fbx')
    const before = commits()
    await a.service.check()
    await settle()
    expect(commits()).toBe(before + 1)
    expect(a.status()).toMatchObject({ via: 'github', repo: 'org/index', lastAction: 'exported' })
    await a.addRepo('org/hero2', 'd1', 'Dog.fbx')
    await a.service.check()
    expect(commits()).toBe(before + 1)
  })
})
