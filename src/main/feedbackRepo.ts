import type { FetchLike } from '@core/github/client'

/**
 * The one place Asset Hub writes to GitHub: issues and issue comments in the
 * feedback repo. Everything else stays behind the read-only client
 * (core/github/client `assertReadOnly`). Anyone who can read a private repo
 * can open issues and comment on it, so no write access is needed.
 */
export function assertFeedbackWrite(repo: string, url: string, method: string): void {
  const path = new URL(url).pathname
  const base = `/repos/${repo}/issues`
  const verb = method.toUpperCase()
  if (verb === 'GET' && path === base) return
  if (verb === 'POST' && (path === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+/comments$`).test(path))) return
  throw new Error(`Not a feedback request: ${verb} ${url}`)
}

export class FeedbackRepo {
  constructor(
    readonly repo: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `https://api.github.com/repos/${this.repo}/issues${path}`
    assertFeedbackWrite(this.repo, url.split('?')[0], method)
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${method} ${path || '/'}`)
    return (await res.json()) as T
  }

  async createIssue(title: string, body: string): Promise<{ number: number; html_url: string }> {
    return this.call('POST', '', { title, body })
  }

  async comment(issue: number, body: string): Promise<void> {
    await this.call('POST', `/${issue}/comments`, { body })
  }

  /** An issue this user opened with exactly this title, open or closed. */
  async findIssue(creator: string, title: string): Promise<number | undefined> {
    for (let page = 1; page <= 10; page++) {
      const list = await this.call<Array<{ number: number; title: string; pull_request?: unknown }>>('GET', `?creator=${encodeURIComponent(creator)}&state=all&per_page=100&page=${page}`)
      const found = list.find((i) => i.title === title && !i.pull_request)
      if (found) return found.number
      if (list.length < 100) return undefined
    }
    return undefined
  }
}
