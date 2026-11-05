import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { appTree, hasBaseFiles, isBaseFile, sameTree, type UpdateManifest } from './appTree'
// @ts-expect-error plain JavaScript build script
import { appTree as buildTree, isBaseFile as buildIsBase } from '../../scripts/appTree.mjs'

const dir = mkdtempSync(join(tmpdir(), 'apptree-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function makeApp(name: string, asar = 'code v1'): string {
  const app = join(dir, name)
  mkdirSync(join(app, 'Contents/Frameworks/E.framework/Versions/A'), { recursive: true })
  mkdirSync(join(app, 'Contents/Resources'), { recursive: true })
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents/Frameworks/E.framework/Versions/A/E'), Buffer.alloc(300 * 1024, 7))
  symlinkSync('A', join(app, 'Contents/Frameworks/E.framework/Versions/Current'))
  writeFileSync(join(app, 'Contents/Resources/app.asar'), asar)
  writeFileSync(join(app, 'Contents/MacOS/Asset Hub'), 'exe')
  chmodSync(join(app, 'Contents/MacOS/Asset Hub'), 0o755)
  return app
}

describe('appTree', () => {
  it('lists files and links the same way in the app and in the build script', async () => {
    const app = makeApp('a.app')
    const tree = await appTree(app)
    expect(await buildTree(app)).toEqual(tree)
    expect(tree.map((e) => [e.path, e.type])).toEqual([
      ['Contents/Frameworks/E.framework/Versions/A/E', 'file'],
      ['Contents/Frameworks/E.framework/Versions/Current', 'link'],
      ['Contents/MacOS/Asset Hub', 'file'],
      ['Contents/Resources/app.asar', 'file']
    ])
    expect(tree.find((e) => e.path === 'Contents/MacOS/Asset Hub')).toMatchObject({ mode: 0o755 })
    expect(tree.map(isBaseFile)).toEqual(tree.map(buildIsBase))
    expect(tree.filter(isBaseFile).map((e) => e.path)).toEqual(['Contents/Frameworks/E.framework/Versions/A/E'])
  })

  it('tells an exact copy from one that differs in content, permissions or links', async () => {
    const want = await appTree(makeApp('b.app'))
    expect(sameTree(await appTree(makeApp('c.app')), want)).toBe(true)
    expect(sameTree(await appTree(makeApp('d.app', 'code v2')), want)).toBe(false)
    const e = makeApp('e.app')
    chmodSync(join(e, 'Contents/MacOS/Asset Hub'), 0o644)
    expect(sameTree(await appTree(e), want)).toBe(false)
    const f = makeApp('f.app')
    writeFileSync(join(f, 'Contents/Resources/extra'), 'x')
    expect(sameTree(await appTree(f), want)).toBe(false)
  })

  it('a small update applies only where Electron’s large files are the same', async () => {
    const app = makeApp('g.app')
    const manifest = { files: await appTree(makeApp('h.app', 'code v2')) } as UpdateManifest
    expect(await hasBaseFiles(app, manifest)).toBe(true)
    writeFileSync(join(app, 'Contents/Frameworks/E.framework/Versions/A/E'), Buffer.alloc(300 * 1024, 8))
    expect(await hasBaseFiles(app, manifest)).toBe(false)
  })
})
