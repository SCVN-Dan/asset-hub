import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../types'
import { groupCatalog, planScan, RepoCatalog, whereIs } from './catalog'

const file = (path: string, sha: string, size = 100): TreeEntry => ({ path, type: 'blob', sha, size })
const typeOf = (path: string) => (path.toLowerCase().endsWith('.fbx') ? 'fbx' : undefined)
const NOW = Date.parse('2026-10-28T00:00:00Z')

function hero(): RepoCatalog {
  const c = RepoCatalog.empty('org/hero')
  c.setBranches(
    [
      { name: 'old', commit: 'c-old', date: '2025-01-01T00:00:00Z' },
      { name: 'main', commit: 'c-main', date: '2026-09-01T00:00:00Z' },
      { name: 'vn/fish', commit: 'c-fish', date: '2026-10-27T00:00:00Z' }
    ],
    'main',
    NOW
  )
  return c
}

describe('RepoCatalog', () => {
  it('orders branches default first, then newest, and plans recent ones first', () => {
    const c = hero()
    expect(c.branches.map((b) => b.name)).toEqual(['main', 'vn/fish', 'old'])
    expect(planScan([c], NOW).map((t) => [t.branch, t.recent])).toEqual([
      ['vn/fish', true],
      ['main', true],
      ['old', false]
    ])
  })

  it('groups identical files across branches and repos', () => {
    const c = hero()
    c.addCommit('c-main', [file('Assets/Shark.fbx', 's1'), file('Assets/Tree.fbx', 't1')])
    c.addCommit('c-fish', [file('Assets/Shark.fbx', 's1'), file('Assets/Fish/Tuna.fbx', 'u1', -1), file('Assets/_ThirdParty/X.fbx', 'x1')])
    const other = RepoCatalog.empty('org/other')
    other.setBranches([{ name: 'main', commit: 'o1' }], 'main', NOW)
    other.addCommit('o1', [file('Art/SharkCopy.fbx', 's1')])
    expect(planScan([c, other], NOW).map((t) => t.branch)).toEqual(['old'])

    const assets = groupCatalog([c, other], typeOf, ['_ThirdParty'])
    const shark = assets.find((a) => a.sha === 's1')!
    expect(shark).toMatchObject({ name: 'Shark.fbx', branchCount: 3, repoCount: 2 })
    expect(shark.locations).toEqual([
      { repo: 'org/hero', path: 'Assets/Shark.fbx', branches: ['main', 'vn/fish'] },
      { repo: 'org/other', path: 'Art/SharkCopy.fbx', branches: ['main'] }
    ])
    expect(assets.map((a) => a.name).sort()).toEqual(['Shark.fbx', 'Tree.fbx', 'Tuna.fbx'])
    expect(whereIs([c, other], 't1')).toEqual([{ repo: 'org/hero', path: 'Assets/Tree.fbx', branches: ['main'] }])
  })

  it('drops commits no branch uses and survives a round trip', () => {
    const c = hero()
    c.addCommit('c-main', [file('Assets/A.fbx', 'a')])
    c.addCommit('c-fish', [file('Assets/B.fbx', 'b')])
    c.setBranches([{ name: 'main', commit: 'c-main' }], 'main', NOW)
    const data = JSON.parse(JSON.stringify(c.toJSON()))
    expect(data.paths).toEqual(['Assets/A.fbx'])
    const back = RepoCatalog.parse('org/hero', data)
    expect([...back.files()].map((f) => f.path)).toEqual(['Assets/A.fbx'])
    expect(RepoCatalog.parse('org/hero', { version: 0 }).branches).toEqual([])
    // Made before textures were indexed: branches kept, commits listed again.
    const old = RepoCatalog.parse('org/hero', data, 'fbx,texture')
    expect(old.branches.map((b) => b.name)).toEqual(['main'])
    expect(old.pending().map((b) => b.name)).toEqual(['main'])
  })
})
