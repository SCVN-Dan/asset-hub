import { describe, expect, it } from 'vitest'
import { parseUnityProcesses } from './unityEditors'

describe('parseUnityProcesses', () => {
  it('reads each editor, its project (spaces included) and version', () => {
    const ps = [
      '  812 /Applications/Unity/Hub/Editor/2022.3.19f1/Unity.app/Contents/MacOS/Unity -projectpath /Users/a/Projects/Luna Pizza -useHub -hubIPC -cloudEnvironment production',
      ' 9001 /Applications/Unity/Hub/Editor/6000.0.1f1/Unity.app/Contents/MacOS/Unity -projectPath "/Users/a/Crab Life/"',
      '  77 /Applications/Unity Hub.app/Contents/MacOS/Unity Hub',
      '  78 /Applications/Unity/Hub/Editor/2022.3.19f1/Unity.app/Contents/MacOS/Unity -batchmode',
      '  80 /Applications/Unity/Hub/Editor/2022.3.19f1/Unity.app/Contents/MacOS/Unity -adb2 -batchMode -noUpm -name AssetImportWorker0 -projectPath /Users/a/Projects/Luna Pizza -logFile Logs/AssetImportWorker0.log',
      '  79 /bin/zsh -c grep Unity.app/Contents/MacOS/Unity'
    ].join('\n')
    expect(parseUnityProcesses(ps)).toEqual([
      { pid: 812, projectPath: '/Users/a/Projects/Luna Pizza', version: '2022.3.19f1' },
      { pid: 9001, projectPath: '/Users/a/Crab Life', version: '6000.0.1f1' }
    ])
  })
})
