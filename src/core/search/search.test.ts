import { describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { AssetSearch, editDistance, nameWords, normalize, parseQuery } from './search'

const asset = (path: string): Asset => ({ id: path, type: 'fbx', path, name: path.split('/').pop()!, sha: path, lfs: false })
const names = (list: Asset[]) => list.map((a) => a.name)

const search = new AssetSearch([
  asset('Assets/Models/Shark_A.fbx'),
  asset('Assets/Models/Dolphin.fbx'),
  asset('Assets/Models/Fish_Tuna_A.fbx'),
  asset('Assets/Models/Enemy_Wlof.fbx'),
  asset('Assets/Models/Cactus_01.fbx'),
  asset('Assets/Models/Castle.fbx'),
  asset('Assets/Animal/Beaver.fbx'),
  asset('Assets/Props/WoodenBoxes.fbx')
])

describe('words', () => {
  it('splits names and drops diacritics', () => {
    expect(nameWords('Fish_TunaA02.fbx')).toEqual(['fish', 'tuna', 'a'])
    expect(normalize('Cá Mập Đỏ')).toBe('ca map do')
    expect(editDistance('wlof', 'wolf', 2)).toBe(2)
    expect(editDistance('fihs', 'fish', 1)).toBe(2)
    expect(editDistance('fsih', 'fish', 2)).toBe(2)
  })

  it('joins words that name a group', () => {
    expect(parseQuery('cá mập').map((t) => t.text)).toEqual(['ca map'])
    expect(parseQuery('red fish').map((t) => t.text)).toEqual(['red', 'fish'])
  })
})

describe('AssetSearch', () => {
  it('finds group members: fish → shark, dolphin, tuna; exact names first', () => {
    const r = search.search('fish')
    expect(names(r.assets)).toEqual(['Fish_Tuna_A.fbx', 'Dolphin.fbx', 'Shark_A.fbx'])
    expect(r.related).toEqual(expect.arrayContaining(['shark', 'dolphin']))
  })

  it('understands Vietnamese and nested groups', () => {
    expect(names(search.search('cá mập').assets)).toEqual(['Shark_A.fbx'])
    expect(names(search.search('ca').assets)).not.toContain('Cactus_01.fbx')
    expect(names(search.search('animal').assets)).toEqual(expect.arrayContaining(['Shark_A.fbx', 'Beaver.fbx', 'Enemy_Wlof.fbx']))
  })

  it('tolerates typos and plurals, and matches folder names', () => {
    expect(names(search.search('dolphn').assets)).toEqual(['Dolphin.fbx'])
    expect(names(search.search('wolf').assets)).toEqual(['Enemy_Wlof.fbx'])
    expect(names(search.search('box').assets)).toEqual(['WoodenBoxes.fbx'])
    expect(names(search.search('props').assets)).toEqual(['WoodenBoxes.fbx'])
  })

  it('needs every word to match', () => {
    expect(names(search.search('shark a').assets)).toEqual(['Shark_A.fbx'])
    expect(search.search('shark beaver').assets).toEqual([])
  })

  it('suggests groups and name words for what is being typed', () => {
    const s = search.suggest('fi')
    expect(s[0]).toMatchObject({ text: 'fish', count: 3 })
    expect(s[0].examples).toEqual(expect.arrayContaining(['shark']))
    expect(search.suggest('cas').map((x) => x.text)).toContain('castle')
    expect(search.suggest('dolpin').map((x) => x.text)).toContain('dolphin')
    expect(search.suggest('cac').map((x) => x.text)).toContain('cactus')
    expect(search.suggest('cá').map((x) => x.text)).toContain('cá mập')
    expect(search.suggest('beaver cá').map((x) => x.text)).toEqual([])
  })
})

describe('AssetSearch extra names', () => {
  it('finds a model by the name of a clip inside it', () => {
    const asset = (name: string) => ({ id: name, type: 'fbx', path: `A/${name}`, name, sha: name, lfs: false })
    const search = new AssetSearch([asset('Goblin.fbx'), asset('Tree.fbx')], (a) => (a.name === 'Goblin.fbx' ? ['Goblin_Run', 'Goblin_Attack'] : []))
    expect(search.search('attack').assets.map((a) => a.name)).toEqual(['Goblin.fbx'])
    expect(search.search('tree').assets.map((a) => a.name)).toEqual(['Tree.fbx'])
  })
})
