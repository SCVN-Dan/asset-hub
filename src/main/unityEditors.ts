import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'

/** A Unity editor running on this Mac, with the project it has open. */
export interface RunningUnity {
  pid: number
  projectPath: string
  /** The project folder's name (what people call the project). */
  project: string
  /** Unity's productName, when it differs from the folder (copied projects often keep an old one). */
  product?: string
  /** Editor version, from its install path (…/Hub/Editor/2022.3.19f1/Unity.app), when it shows. */
  version?: string
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => execFile(cmd, args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(out))))

/**
 * Editors from `ps` lines ("<pid> <command line>"). The project comes from
 * -projectPath, which Unity Hub always passes; a path may hold spaces, so it
 * runs up to the next " -flag". Lines of other programs are skipped.
 */
export function parseUnityProcesses(psOutput: string): Array<{ pid: number; projectPath: string; version?: string }> {
  const found: Array<{ pid: number; projectPath: string; version?: string }> = []
  for (const line of psOutput.split('\n')) {
    const m = /^\s*(\d+)\s+(.*\/Unity\.app\/Contents\/MacOS\/Unity)(\s.*)?$/.exec(line)
    if (!m) continue
    const project = /\s-projectpath\s+(.+?)(?=\s+-[A-Za-z]|$)/i.exec(m[3] ?? '')?.[1]?.trim().replace(/^"(.*)"$/, '$1')
    if (!project) continue
    const version = /\/Editor\/([^/]+)\/Unity\.app\//.exec(m[2])?.[1]
    found.push({ pid: Number(m[1]), projectPath: project.replace(/\/+$/, ''), ...(version ? { version } : {}) })
  }
  return found
}

/** The Unity editors open right now, each with its project (only real Unity projects). */
export async function listRunningUnity(): Promise<RunningUnity[]> {
  if (process.platform !== 'darwin') return []
  const editors = parseUnityProcesses(await run('ps', ['-axo', 'pid=,args=']))
  return editors
    .filter((e) => existsSync(join(e.projectPath, 'Assets')) && existsSync(join(e.projectPath, 'ProjectSettings')))
    .map((e) => {
      const product = productName(e.projectPath)
      return { ...e, project: basename(e.projectPath), ...(product && product !== basename(e.projectPath) ? { product } : {}) }
    })
}

/** productName from ProjectSettings, when readable and set. */
function productName(path: string): string | undefined {
  try {
    const name = /^\s*productName:\s*(.+)$/m.exec(readFileSync(join(path, 'ProjectSettings/ProjectSettings.asset'), 'utf8'))?.[1]?.trim()
    return name && name !== 'New Unity Project' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * Hands `file` to the editor with process id `pid`, as double-clicking it would
 * — but to that one editor even when several are open (`open -a` picks any).
 * An "open documents" Apple Event addressed by process id; Unity then shows its
 * import dialog for a .unitypackage. The editor is brought to the front.
 */
export async function openInProcess(pid: number, file: string): Promise<void> {
  const script = `
ObjC.import('AppKit')
const pid = ${Number(pid)}
const target = $.NSAppleEventDescriptor.descriptorWithProcessIdentifier(pid)
const event = $.NSAppleEventDescriptor.appleEventWithEventClassEventIDTargetDescriptorReturnIDTransactionID(0x61657674, 0x6f646f63, target, -1, 0)
const url = $.NSURL.fileURLWithPath(${JSON.stringify(file)})
const files = $.NSAppleEventDescriptor.listDescriptor
files.insertDescriptorAtIndex($.NSAppleEventDescriptor.descriptorWithDescriptorTypeData(0x6675726c, url.absoluteString.dataUsingEncoding($.NSUTF8StringEncoding)), 1)
event.setParamDescriptorForKeyword(files, 0x2d2d2d2d)
const error = Ref()
const reply = event.sendEventWithOptionsTimeoutError(1, 15, error)
if (reply.isNil()) throw new Error('Unity did not take the file')
const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid)
if (!app.isNil()) app.activateWithOptions(2)
'ok'`
  await run('osascript', ['-l', 'JavaScript', '-e', script])
}
