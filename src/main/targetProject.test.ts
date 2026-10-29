import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentHash, hashProjectFile, isUnityProject, scanProject } from './targetProject'

const G = (c: string) => c.repeat(32)
let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'assethub-target-'))
  await mkdir(join(root, 'Assets/Art/Hidden~'), { recursive: true })
  await mkdir(join(root, 'ProjectSettings'))
  await writeFile(join(root, 'Assets/Art/rock.png'), 'PNGDATA')
  await writeFile(join(root, 'Assets/Art/rock.png.meta'), `fileFormatVersion: 2\nguid: ${G('a')}\nTextureImporter:\n`)
  await writeFile(join(root, 'Assets/Art/Hidden~/skip.png'), 'PNGDATA')
  await writeFile(join(root, 'Assets/.DS_Store'), 'x')
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('target project', () => {
  it('knows a Unity project folder', async () => {
    expect(await isUnityProject(root)).toBe(true)
    expect(await isUnityProject(join(root, 'Assets'))).toBe(false)
  })

  it('reads GUIDs and sizes under Assets, skipping what Unity ignores', async () => {
    const p = await scanProject(root)
    expect([...p.byGuid]).toEqual([[G('a'), 'Assets/Art/rock.png']])
    expect([...p.sizes]).toEqual([['Assets/Art/rock.png', 7]])
    expect(p.bySize.get(7)).toEqual(['Assets/Art/rock.png'])
    expect(await hashProjectFile(root, 'Assets/Art/rock.png')).toBe(contentHash(new TextEncoder().encode('PNGDATA')))
  })
})
