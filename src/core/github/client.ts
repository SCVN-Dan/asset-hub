import { SourceError } from '../errors'
import type { RepoRef, TreeEntry } from '../types'

/** Minimal fetch shape so tests can inject a fake and main can use Electron's net.fetch. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}>

export interface GitHubUser {
  login: string
  name?: string
}

const API = 'https://api.github.com'
/** Max pages followed for list endpoints (100 items each). */
const MAX_PAGES = 20
/** Aliases per GraphQL query when reading many small blobs. */
const GRAPHQL_BATCH = 40
const MAX_RETRIES = 4

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Gateway timeouts, cut-off JSON and dropped connections are worth retrying. */
function isTransient(err: unknown): boolean {
  if (err instanceof SyntaxError) return true
  if (!(err instanceof SourceError)) return false
  return err.code === 'network' || [500, 502, 503, 504].includes(err.detail.status ?? 0)
}

function splitRepo(repo: string): [string, string] {
  const [owner, name, ...rest] = repo.split('/')
  if (!owner || !name || rest.length) throw new SourceError('notFound', `Invalid repository name "${repo}"`)
  return [owner, name]
}

const repoPath = (repo: string) => splitRepo(repo).map(encodeURIComponent).join('/')
const refPath = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
    private readonly apiBase = API
  ) {}

  async getUser(): Promise<GitHubUser> {
    const { data } = await this.request<{ login: string; name?: string | null }>('/user')
    return { login: data.login, name: data.name ?? undefined }
  }

  async listRepos(): Promise<RepoRef[]> {
    const repos = await this.paginate<{ full_name: string; default_branch: string }>(
      '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'
    )
    return repos.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch }))
  }

  async listBranches(repo: string): Promise<string[]> {
    const branches = await this.paginate<{ name: string }>(`/repos/${repoPath(repo)}/branches?per_page=100`)
    return branches.map((b) => b.name)
  }

  /** Commit SHA at the tip of a branch. */
  async getBranchHead(repo: string, branch: string): Promise<string> {
    const { data } = await this.request<{ object: { sha: string } }>(`/repos/${repoPath(repo)}/git/ref/heads/${refPath(branch)}`)
    return data.object.sha
  }

  /** Full recursive tree of a commit. `truncated` is set when GitHub cut the listing short. */
  async getTree(repo: string, commitSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const { data } = await this.request<{
      truncated: boolean
      tree: Array<{ path: string; type: string; sha: string; size?: number }>
    }>(`/repos/${repoPath(repo)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`)
    const entries: TreeEntry[] = []
    for (const item of data.tree) {
      // 'commit' entries are submodules; they are not part of this repo's files.
      if (item.type !== 'blob' && item.type !== 'tree') continue
      entries.push({ path: item.path, type: item.type, sha: item.sha, size: item.size })
    }
    return { entries, truncated: data.truncated }
  }

  /** Text of one file at a commit, or undefined when it does not exist. */
  async getFileText(repo: string, commitSha: string, path: string): Promise<string | undefined> {
    const texts = await this.getBlobTexts(repo, commitSha, [path])
    return texts.get(path)
  }

  /**
   * Reads many small text blobs (LFS pointers, .gitattributes) with batched
   * GraphQL queries — one request per 50 files instead of one each.
   */
  async getBlobTexts(repo: string, commitSha: string, paths: readonly string[]): Promise<Map<string, string>> {
    const [owner, name] = splitRepo(repo)
    const result = new Map<string, string>()
    for (let start = 0; start < paths.length; start += GRAPHQL_BATCH) {
      for (const [p, text] of await this.blobTextBatch(owner, name, commitSha, paths.slice(start, start + GRAPHQL_BATCH))) result.set(p, text)
    }
    return result
  }

  /** One GraphQL query; on a transient failure the batch is split in half and retried with backoff. */
  private async blobTextBatch(owner: string, name: string, commitSha: string, batch: readonly string[], attempt = 0): Promise<Map<string, string>> {
    try {
      const result = new Map<string, string>()
      const fields = batch
        .map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${commitSha}:${p}`)}) { ... on Blob { text isTruncated oid } }`)
        .join('\n')
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`
      const { data } = await this.request<{
        data?: { repository: Record<string, { text: string | null; isTruncated?: boolean; oid?: string } | null> | null }
        errors?: Array<{ type?: string; message: string }>
      }>('/graphql', { method: 'POST', body: JSON.stringify({ query }) })
      const repoData = data.data?.repository
      if (!repoData) {
        const err = data.errors?.[0]
        const code = err?.type === 'NOT_FOUND' ? 'notFound' : err?.type === 'RATE_LIMITED' ? 'rateLimited' : 'unknown'
        throw new SourceError(code, err?.message ?? 'GraphQL request failed')
      }
      const truncated: Array<{ path: string; oid: string }> = []
      batch.forEach((p, i) => {
        const blob = repoData[`f${i}`]
        if (blob?.isTruncated && blob.oid) truncated.push({ path: p, oid: blob.oid })
        else if (typeof blob?.text === 'string') result.set(p, blob.text)
      })
      // GraphQL cuts long texts (large prefabs, big .meta files); read those whole from the blob API.
      const dec = new TextDecoder()
      for (const t of truncated) result.set(t.path, dec.decode(await this.getBlobBytes(`${owner}/${name}`, t.oid)))
      return result
    } catch (err) {
      if (!isTransient(err) || attempt >= MAX_RETRIES) throw err
      await sleep(400 * 2 ** attempt)
      if (batch.length <= 5) return this.blobTextBatch(owner, name, commitSha, batch, attempt + 1)
      const half = Math.ceil(batch.length / 2)
      const [a, b] = await Promise.all([
        this.blobTextBatch(owner, name, commitSha, batch.slice(0, half), attempt + 1),
        this.blobTextBatch(owner, name, commitSha, batch.slice(half), attempt + 1)
      ])
      return new Map([...a, ...b])
    }
  }

  /** Raw contents of a git blob (up to 100 MB). */
  async getBlobBytes(repo: string, sha: string): Promise<Uint8Array> {
    const res = await this.send(`${this.apiBase}/repos/${repoPath(repo)}/git/blobs/${encodeURIComponent(sha)}`, {
      headers: { Accept: 'application/vnd.github.raw' }
    })
    return new Uint8Array(await res.arrayBuffer())
  }

  /** Real contents of a Git LFS object, through the LFS batch API. */
  async getLfsObject(repo: string, oid: string, size: number): Promise<Uint8Array> {
    const auth = `Basic ${btoa(`x-access-token:${this.token}`)}`
    const batch = await this.send(`https://github.com/${repo}.git/info/lfs/objects/batch`, {
      method: 'POST',
      auth,
      headers: { Accept: 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json' },
      body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: [{ oid, size }] })
    })
    const data = (await batch.json()) as {
      objects: Array<{ error?: { message: string }; actions?: { download?: { href: string; header?: Record<string, string> } } }>
    }
    const obj = data.objects[0]
    const download = obj?.actions?.download
    if (!download) throw new SourceError('notFound', obj?.error?.message ?? `LFS object ${oid} is not available`)
    const res = await this.send(download.href, { auth: null, headers: download.header ?? {} })
    return new Uint8Array(await res.arrayBuffer())
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const items: T[] = []
    let url: string | undefined = path
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const { data, headers } = await this.request<T[]>(url)
      items.push(...data)
      url = nextLink(headers.get('link'))
    }
    return items
  }

  private async request<T>(
    pathOrUrl: string,
    init: { method?: string; body?: string } = {}
  ): Promise<{ data: T; headers: { get(name: string): string | null } }> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : this.apiBase + pathOrUrl
    const res = await this.send(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {})
      }
    })
    return { data: (await res.json()) as T, headers: res.headers }
  }

  /** Sends a request and maps failures to SourceError. `auth: null` sends no Authorization (pre-signed URLs). */
  private async send(
    url: string,
    init: { method?: string; body?: string; headers?: Record<string, string>; auth?: string | null } = {}
  ): Promise<Awaited<ReturnType<FetchLike>>> {
    const auth = init.auth === undefined ? `Bearer ${this.token}` : init.auth
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        body: init.body,
        headers: { ...(auth ? { Authorization: auth } : {}), ...init.headers }
      })
    } catch (err) {
      throw new SourceError('network', err instanceof Error ? err.message : String(err))
    }
    if (res.ok) return res
    throw await toSourceError(res)
  }
}

async function toSourceError(res: Awaited<ReturnType<FetchLike>>): Promise<SourceError> {
  let message = `GitHub responded ${res.status}`
  try {
    const body = (await res.json()) as { message?: string }
    if (body?.message) message = body.message
  } catch {
    // keep the status message
  }
  const sso = res.headers.get('x-github-sso')
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined
  const status = res.status
  if (status === 401) return new SourceError('unauthorized', message, { status })
  if (status === 403 && sso) return new SourceError('sso', message, { status, ssoUrl: /url=(\S+)/.exec(sso)?.[1] })
  // Secondary (abuse) limits come as 403 with Retry-After or a message, not remaining=0.
  const retryAfter = Number(res.headers.get('retry-after'))
  if (status === 429 || (status === 403 && (remaining === '0' || retryAfter > 0 || /rate limit/i.test(message))))
    return new SourceError('rateLimited', message, { status, resetAt: resetAt ?? (retryAfter > 0 ? Date.now() + retryAfter * 1000 : undefined) })
  if (status === 403) return new SourceError('forbidden', message, { status })
  if (status === 404) return new SourceError('notFound', message, { status })
  return new SourceError('unknown', message, { status })
}

/** Extracts rel="next" from a GitHub Link header. */
export function nextLink(header: string | null): string | undefined {
  if (!header) return undefined
  for (const part of header.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part)
    if (match) return match[1]
  }
  return undefined
}
