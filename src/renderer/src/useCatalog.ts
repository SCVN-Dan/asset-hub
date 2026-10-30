import { useEffect, useRef, useState } from 'react'
import type { CatalogAsset } from '@core/index'
import type { CatalogStatus } from '@shared/ipc'
import { unwrap } from './remoteSource'
import { useSharedImports } from './useSharedIndex'

/** Where a search looks: the open branch, every branch of the repo, or every repo. */
export type SearchScope = 'branch' | 'repo' | 'all'

/** Results are re-read at most this often while branches are being indexed. */
const REFRESH_MS = 3000

/**
 * The cross-branch catalog for a scope: starts indexing when the scope is
 * opened, and re-reads the results as branches get listed.
 */
export function useCatalog(scope: SearchScope, repo: string, branch: string, excludedFolders: readonly string[], enabled: boolean) {
  const [status, setStatus] = useState<CatalogStatus>({ state: 'idle', done: 0, total: 0 })
  const [assets, setAssets] = useState<CatalogAsset[]>()
  const [error, setError] = useState<unknown>()
  const [version, setVersion] = useState(0)
  const lastRead = useRef(0)
  const active = enabled && scope !== 'branch' && (scope === 'all' || !!repo)
  const target = scope === 'repo' ? repo : null
  const imports = useSharedImports()

  useEffect(() => {
    if (!enabled) return
    void window.api.catalog.status().then((r) => r.ok && setStatus(r.data))
    return window.api.catalog.onStatus(setStatus)
  }, [enabled])

  // Opening a scope (re)checks its branches and queues the new ones.
  useEffect(() => {
    if (!active) return
    setAssets(undefined)
    setError(undefined)
    // The open branch is listed first, so its results show up right away.
    void window.api.catalog.scan(target ?? undefined, repo ? { repo, branch } : undefined).then((r) => {
      if (!r.ok) setError(r.error)
      setVersion((v) => v + 1)
    })
  }, [active, target])

  // A teammate's index taken in: results read again.
  useEffect(() => {
    if (active && imports) setVersion((v) => v + 1)
  }, [imports])

  // New branches listed: read the results again, but not on every step.
  useEffect(() => {
    if (!active) return
    const wait = Math.max(0, lastRead.current + REFRESH_MS - Date.now())
    const timer = setTimeout(() => setVersion((v) => v + 1), status.state === 'running' ? wait : 0)
    return () => clearTimeout(timer)
  }, [active, status.done, status.state])

  useEffect(() => {
    if (!active || !version) return
    let cancelled = false
    lastRead.current = Date.now()
    window.api.catalog.list(target, [...excludedFolders]).then(
      (r) => {
        if (cancelled) return
        try {
          setAssets(unwrap(r))
        } catch (err) {
          setError(err)
        }
      },
      (err: unknown) => !cancelled && setError(err)
    )
    return () => {
      cancelled = true
    }
  }, [active, target, version, excludedFolders])

  return {
    status,
    assets: active ? assets : undefined,
    error: active ? error : undefined,
    pause: () => void window.api.catalog.pause().then((r) => r.ok && setStatus(r.data)),
    resume: () => void window.api.catalog.resume().then((r) => r.ok && setStatus(r.data))
  }
}
