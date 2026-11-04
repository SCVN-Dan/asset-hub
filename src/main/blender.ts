import { execFile, spawn } from 'child_process'
import { access, readdir, rm, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

const exists = (p: string) => access(p).then(() => true, () => false)

/** Blender's program on this Mac: /Applications, ~/Applications, else wherever Spotlight knows it. */
export async function findBlender(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  const bin = (app: string) => join(app, 'Contents/MacOS/Blender')
  for (const app of ['/Applications/Blender.app', join(homedir(), 'Applications/Blender.app')]) if (await exists(bin(app))) return bin(app)
  const found = await new Promise<string>((resolve) =>
    execFile('mdfind', ["kMDItemCFBundleIdentifier == 'org.blenderfoundation.blender'"], { timeout: 5000 }, (_e, out) => resolve(String(out ?? '')))
  )
  for (const app of found.split('\n').filter(Boolean)) if (await exists(bin(app))) return bin(app)
  return undefined
}

/** Starts a new Blender that runs `script` (which imports the model), left running on its own. */
export function openInBlender(blender: string, script: string): void {
  spawn(blender, ['--python', script], { detached: true, stdio: 'ignore' }).unref()
}

/** Folders a Blender run left behind (it crashed, or was closed before the script finished): gone after a day. */
export async function sweepBlenderTemp(dir: string, maxAgeMs = 24 * 3600 * 1000): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  await Promise.all(
    names.map(async (n) => {
      const p = join(dir, n)
      const s = await stat(p).catch(() => undefined)
      if (s && now - s.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true })
    })
  )
}
