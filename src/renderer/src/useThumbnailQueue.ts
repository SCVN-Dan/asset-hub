import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveContext } from './components/ModelViewer'
import { renderThumbnail } from './viewer/backgroundThumb'

const CONCURRENCY = 2
/** A model whose thumbnail failed is retried after this long (the network may be back). */
const RETRY_MS = 2 * 60_000

interface Job {
  key: string
  path: string
}

/**
 * Renders thumbnails in the background for cards that are on screen. Cards
 * that scroll away before their turn are dropped; the newest request goes
 * first, so whatever the user is looking at renders next.
 */
export function useThumbnailQueue(live: LiveContext | undefined, onThumb: (key: string, dataUrl: string) => void) {
  const queue = useRef<Job[]>([])
  const active = useRef(new Set<string>())
  const failed = useRef(new Map<string, number>())
  const liveRef = useRef(live)
  const onThumbRef = useRef(onThumb)
  liveRef.current = live
  onThumbRef.current = onThumb
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const sync = () => setBusy(new Set([...active.current, ...queue.current.map((j) => j.key)]))

  const pump = useCallback(() => {
    while (active.current.size < CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!
      const ctx = liveRef.current
      if (!ctx) break
      active.current.add(job.key)
      void renderThumbnail(ctx, job.path)
        .then((url) => onThumbRef.current(job.key, url))
        .catch(() => failed.current.set(job.key, Date.now()))
        .finally(() => {
          active.current.delete(job.key)
          sync()
          pump()
        })
    }
    sync()
  }, [])

  // Jobs belong to one repo + branch.
  useEffect(() => {
    queue.current = []
    sync()
  }, [live?.repo, live?.branch, live?.root])

  const request = useCallback(
    (key: string, path: string) => {
      if (!liveRef.current || active.current.has(key) || Date.now() - (failed.current.get(key) ?? -Infinity) < RETRY_MS) return
      queue.current = [{ key, path }, ...queue.current.filter((j) => j.key !== key)]
      pump()
    },
    [pump]
  )

  const cancel = useCallback((key: string) => {
    const before = queue.current.length
    queue.current = queue.current.filter((j) => j.key !== key)
    if (queue.current.length !== before) sync()
  }, [])

  return { busy, request, cancel }
}
