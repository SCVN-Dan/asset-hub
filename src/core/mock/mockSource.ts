import type { AssetSource } from '../source'
import type { RepoRef, TreeEntry } from '../types'

const REPO = 'demo/sample-unity-project'

/** [path, size in bytes, stored in LFS] — a small Unity project with FBX, materials, textures and noise. */
const FILES: Array<[string, number, boolean]> = [
  ['Assets/Art/Characters/Knight/Knight_Hero.fbx', 4_812_330, true],
  ['Assets/Art/Characters/Knight/Materials/Knight_Body.mat', 2_140, false],
  ['Assets/Art/Characters/Knight/Materials/Knight_Armor.mat', 2_210, false],
  ['Assets/Art/Characters/Knight/Textures/Knight_Body_Albedo.png', 3_402_118, true],
  ['Assets/Art/Characters/Knight/Textures/Knight_Body_Normal.png', 2_988_004, true],
  ['Assets/Art/Characters/Goblin/Goblin_Archer.fbx', 2_604_771, true],
  ['Assets/Art/Characters/Goblin/Goblin.mat', 1_980, false],
  ['Assets/Art/Characters/Goblin/Goblin_Albedo.png', 1_420_662, true],
  ['Assets/Art/Characters/Crab/Crab_Boss.fbx', 6_210_450, true],
  ['Assets/Art/Characters/Crab/Crab_Shell.mat', 2_064, false],
  ['Assets/Art/Characters/Crab/ToonShell.shadergraph', 48_220, false],
  ['Assets/Art/Environment/Trees/Tree_Pine_A.fbx', 1_204_998, true],
  ['Assets/Art/Environment/Trees/Pine_Bark.png', 880_402, true],
  ['Assets/Art/Environment/Rocks/Rock_Cluster_02.fbx', 954_118, true],
  ['Assets/Art/Environment/Rocks/rock_small.FBX', 310_224, true],
  ['Assets/Art/Props/Chest_Wood.fbx', 702_331, true],
  ['Assets/Art/Props/Barrel_01.fbx', 412_987, true],
  ['Assets/Art/Weapons/Sword_Iron.fbx', 288_640, true],
  ['Assets/Art/Shared/Metal_Shared_Mask.png', 512_330, true],
  ['Assets/_ThirdParty/FX/Smoke_Puff.fbx', 120_400, true],
  ['ProjectSettings/ProjectVersion.txt', 82, false],
  ['Assets/Scenes/Main.unity', 120_554, false],
  ['Assets/Scripts/Player.cs', 4_210, false],
  ['Packages/manifest.json', 1_302, false],
  ['ProjectSettings/GraphicsSettings.asset', 2_408, false]
]

/** Extra files that only exist on the `develop` branch. */
const DEVELOP_ONLY: Array<[string, number, boolean]> = [
  ['Assets/Art/Characters/Mage/Mage_Fire.fbx', 3_120_008, true],
  ['Assets/Art/Characters/Mage/Mage_Fire.mat', 2_100, false]
]

/** Deterministic fake 40-char SHA so ids stay stable between runs. */
function fakeSha(input: string): string {
  let h1 = 0x811c9dc5
  let out = ''
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < input.length; i++) {
      h1 ^= input.charCodeAt(i) + round
      h1 = Math.imul(h1, 0x01000193) >>> 0
    }
    out += h1.toString(16).padStart(8, '0')
  }
  return out
}

function toEntries(files: Array<[string, number, boolean]>): TreeEntry[] {
  const entries: TreeEntry[] = []
  const folders = new Set<string>()
  for (const [path, size, lfs] of files) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'))
    entries.push(
      lfs
        ? { path, type: 'blob', sha: fakeSha(path), size: 132, lfs: true, lfsSize: size }
        : { path, type: 'blob', sha: fakeSha(path), size }
    )
    // Every Unity asset has a .meta next to it; they must never show up as assets.
    if (path.startsWith('Assets/')) entries.push({ path: `${path}.meta`, type: 'blob', sha: fakeSha(`${path}.meta`), size: 420 })
  }
  for (const folder of folders) entries.push({ path: folder, type: 'tree', sha: fakeSha(folder) })
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

export class MockAssetSource implements AssetSource {
  readonly id = 'mock'
  readonly isDemo = true

  async listRepos(): Promise<RepoRef[]> {
    return [{ fullName: REPO, defaultBranch: 'main' }]
  }

  async listBranches(): Promise<string[]> {
    return ['main', 'develop']
  }

  async listTree(_repo: string, branch: string): Promise<TreeEntry[]> {
    return toEntries(branch === 'develop' ? [...FILES, ...DEVELOP_ONLY] : FILES)
  }
}
