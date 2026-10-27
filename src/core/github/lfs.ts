export interface LfsPointer {
  oid: string
  size: number
}

/** Parses a Git LFS pointer file; undefined when the text is not a pointer. */
export function parseLfsPointer(text: string): LfsPointer | undefined {
  if (!text.startsWith('version https://git-lfs.github.com/spec/')) return undefined
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1]
  const size = /^size (\d+)$/m.exec(text)?.[1]
  if (!oid || !size) return undefined
  return { oid, size: Number(size) }
}

/**
 * Returns the patterns of a .gitattributes file that route files through LFS,
 * as regular expressions over repo-relative paths. Handles the common forms
 * (`*.fbx`, `*.[fF][bB][xX]`, `Assets/**\/*.png`, `/Art/*.psd`); later lines
 * that unset `filter` are honoured by `isLfsPath`.
 */
export function parseLfsAttributes(text: string): Array<{ re: RegExp; lfs: boolean }> {
  const rules: Array<{ re: RegExp; lfs: boolean }> = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [pattern, ...attrs] = line.split(/\s+/)
    if (!pattern || pattern.startsWith('!')) continue
    if (attrs.includes('filter=lfs')) rules.push({ re: globToRegExp(pattern), lfs: true })
    else if (attrs.some((a) => a === '-filter' || a === '!filter' || (a.startsWith('filter=') && a !== 'filter=lfs')))
      rules.push({ re: globToRegExp(pattern), lfs: false })
  }
  return rules
}

/** Last matching rule wins, as in git. */
export function isLfsPath(path: string, rules: ReadonlyArray<{ re: RegExp; lfs: boolean }>): boolean {
  let result = false
  for (const rule of rules) if (rule.re.test(path)) result = rule.lfs
  return result
}

function globToRegExp(pattern: string): RegExp {
  // A pattern without a slash matches the file name at any depth.
  const anchored = pattern.includes('/')
  const body = pattern.replace(/^\//, '')
  let re = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '*') {
      if (body[i + 1] === '*') {
        const slash = body[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const end = body.indexOf(']', i + 1)
      if (end === -1) re += '\\['
      else {
        re += body.slice(i, end + 1).replace(/^\[!/, '[^')
        i = end
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`)
}
