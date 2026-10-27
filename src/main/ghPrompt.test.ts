import { describe, expect, it } from 'vitest'
import { parseGhLoginPrompt } from './ghPrompt'

const URL_LINE = 'Open this URL to continue in your web browser: https://github.com/login/device'

describe('parseGhLoginPrompt', () => {
  it('reads the older gh wording', () => {
    expect(parseGhLoginPrompt(`! First copy your one-time code: 4915-D299\n${URL_LINE}\n`)).toEqual({
      code: '4915-D299',
      url: 'https://github.com/login/device'
    })
  })

  it('reads the gh 2.103 wording', () => {
    expect(parseGhLoginPrompt(`\n! One-time code (2C04-3C10) copied to clipboard\n${URL_LINE}\n`)?.code).toBe('2C04-3C10')
  })

  it('waits until both the code and the URL have arrived', () => {
    expect(parseGhLoginPrompt('! One-time code (2C04-3C10) copied to clipboard\n')).toBeUndefined()
    expect(parseGhLoginPrompt(URL_LINE)).toBeUndefined()
  })
})
