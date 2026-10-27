import { execFile, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { delimiter, dirname, join } from 'path'
import { safeStorage } from 'electron'
import { parseGhLoginPrompt, type GhLoginPrompt } from './ghPrompt'
import type { AuthMethod } from '@shared/ipc'

/** Errors specific to obtaining a token (as opposed to calling GitHub). */
export class AuthError extends Error {
  constructor(
    readonly code: 'ghNotFound' | 'ghNotLoggedIn' | 'emptyToken' | 'ghInstallFailed',
    message: string
  ) {
    super(message)
  }
}

interface StoredAuth {
  method: AuthMethod
  /** Base64 of the safeStorage-encrypted PAT; absent for 'gh', whose token is re-read from gh each launch. */
  token?: string
}

/** Remembers how the user signed in. PATs are encrypted with the OS keychain via safeStorage. */
export class AuthStore {
  constructor(private readonly file: string) {}

  load(): { method: AuthMethod; token?: string } | undefined {
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredAuth
      if (stored.method === 'gh') return { method: 'gh' }
      if (stored.method === 'pat' && stored.token && safeStorage.isEncryptionAvailable()) {
        return { method: 'pat', token: safeStorage.decryptString(Buffer.from(stored.token, 'base64')) }
      }
    } catch {
      // missing or unreadable: treat as signed out
    }
    return undefined
  }

  /** Returns false when the method could not be persisted (no keychain): the session stays in memory only. */
  save(method: AuthMethod, token: string): boolean {
    let stored: StoredAuth
    if (method === 'gh') stored = { method }
    else if (safeStorage.isEncryptionAvailable()) stored = { method, token: safeStorage.encryptString(token).toString('base64') }
    else {
      this.clear()
      return false
    }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(stored), { mode: 0o600 })
    return true
  }

  clear(): void {
    rmSync(this.file, { force: true })
  }
}

/** gh that the app downloaded itself (see ghInstaller); used when no system gh exists. */
let managedGh: string | undefined
export function setManagedGh(path: string | undefined): void {
  managedGh = path
}

/** Apps launched from Finder get a minimal PATH, so also look where gh is usually installed. */
export function findGh(): string | undefined {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    'C:\\Program Files\\GitHub CLI'
  ]
  const names = process.platform === 'win32' ? ['gh.exe'] : ['gh']
  for (const dir of dirs) for (const name of names) if (dir && existsSync(join(dir, name))) return join(dir, name)
  return managedGh && existsSync(managedGh) ? managedGh : undefined
}

/**
 * Runs `gh auth login --web` without a terminal: gh prints a one-time code and
 * the device URL, then waits until the user approves in the browser. This uses
 * GitHub CLI's own OAuth app, so no organisation GitHub App is needed.
 */
export type { GhLoginPrompt }

export function ghWebLogin(onPrompt: (prompt: GhLoginPrompt) => void): { done: Promise<void>; cancel(): void } {
  const gh = findGh()
  if (!gh) return { done: Promise.reject(new AuthError('ghNotFound', 'GitHub CLI (gh) was not found')), cancel: () => {} }
  const child = spawn(gh, ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Keep gh from opening a browser itself; the app opens it when the user clicks.
    env: { ...process.env, GH_BROWSER: 'true', BROWSER: 'true' }
  })
  let output = ''
  let prompted = false
  const onData = (chunk: Buffer) => {
    output += chunk.toString()
    const prompt = prompted ? undefined : parseGhLoginPrompt(output)
    if (prompt) {
      prompted = true
      onPrompt(prompt)
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  let stalled = false
  // If gh changes its wording again, fail visibly instead of waiting forever.
  const watchdog = setTimeout(() => {
    if (prompted) return
    stalled = true
    child.kill()
  }, 20_000)
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => reject(new AuthError('ghNotLoggedIn', err.message)))
    child.on('close', (code) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else if (stalled) reject(new AuthError('ghNotLoggedIn', `No sign-in code from gh. Output: ${output.trim() || '(none)'}`))
      else reject(new AuthError('ghNotLoggedIn', output.trim().split('\n').pop() || `gh exited with ${code}`))
    })
  })
  return { done, cancel: () => child.kill() }
}

/** Token of the account logged in with `gh auth login`. */
export function readGhToken(): Promise<string> {
  const gh = findGh()
  if (!gh) return Promise.reject(new AuthError('ghNotFound', 'GitHub CLI (gh) was not found'))
  return new Promise((resolve, reject) => {
    execFile(gh, ['auth', 'token', '--hostname', 'github.com'], { timeout: 15_000 }, (err, stdout, stderr) => {
      const token = stdout.trim()
      if (err || !token) reject(new AuthError('ghNotLoggedIn', (stderr || err?.message || 'gh is not logged in').trim()))
      else resolve(token)
    })
  })
}
