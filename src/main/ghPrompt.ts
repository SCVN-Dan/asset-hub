export interface GhLoginPrompt {
  code: string
  url: string
}

/**
 * Finds the one-time code and device URL in `gh auth login --web` output.
 * gh has worded this differently across versions, e.g.
 *   "! First copy your one-time code: 4915-D299"           (≤ 2.100)
 *   "! One-time code (2C04-3C10) copied to clipboard"      (2.103)
 * so match the code shape near "code" rather than one exact sentence.
 */
export function parseGhLoginPrompt(output: string): GhLoginPrompt | undefined {
  const code = /code\W{0,4}([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(output)?.[1]
  const url = /(https:\/\/github\.com\/login\/device\S*)/.exec(output)?.[1]
  return code && url ? { code: code.toUpperCase(), url } : undefined
}
