import { describe, expect, it } from 'vitest'
import { importedObjectId, meshForFileId, xxHash64 } from './importedIds'

describe('fileIDs of imported model objects', () => {
  it('hashes like xxHash64', () => {
    expect(xxHash64(new Uint8Array())).toBe(0xef46db3751d8e999n)
    expect(xxHash64(new TextEncoder().encode('a'))).toBe(0xd24ec4f1a98c6e5bn)
  })

  it('gives mesh fileIDs as prefabs write them (Unity 2019.3+, nothing listed in the .meta)', () => {
    // Measured on luna_spinminer: Object.fbx "Grass", Object_02.fbx "Branch".
    expect(importedObjectId('Mesh', 'Grass')).toBe('8254687373856176130')
    expect(importedObjectId('Mesh', 'Branch')).toBe('571416741228946723')
  })

  it('finds the mesh a fileID stands for, counting repeated names', () => {
    const second = importedObjectId('Mesh', 'Rock', 1)
    expect(meshForFileId(['Rock', 'Grass', 'Rock'], second)).toBe(2)
    expect(meshForFileId(['Rock', 'Grass'], '8254687373856176130')).toBe(1)
    expect(meshForFileId(['Rock'], '1')).toBe(-1)
  })
})
