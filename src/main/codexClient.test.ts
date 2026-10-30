import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import { CodexClient } from './codexClient'

function pair(handle = async (_m: string, _p: unknown): Promise<unknown> => ({ ok: true })) {
  const toCodex = new PassThrough()
  const fromCodex = new PassThrough()
  const sent: Array<Record<string, unknown>> = []
  toCodex.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach((l) => sent.push(JSON.parse(l))))
  const client = new CodexClient({ stdin: toCodex, stdout: fromCodex }, handle)
  const reply = (msg: object) => fromCodex.write(`${JSON.stringify(msg)}\n`)
  const tick = () => new Promise((r) => setTimeout(r, 5))
  return { client, sent, reply, tick }
}

describe('CodexClient', () => {
  it('matches responses to requests by id, without a jsonrpc field', async () => {
    const { client, sent, reply, tick } = pair()
    const a = client.request<{ n: number }>('account/read', { refreshToken: false })
    const b = client.request('thread/start')
    await tick()
    expect(sent).toEqual([{ method: 'account/read', id: 1, params: { refreshToken: false } }, { method: 'thread/start', id: 2 }])
    reply({ id: 2, result: 'second' })
    reply({ id: 1, result: { n: 1 } })
    await expect(a).resolves.toEqual({ n: 1 })
    await expect(b).resolves.toBe('second')
  })

  it('rejects on an error response, and every waiting request once closed', async () => {
    const { client, reply, tick } = pair()
    const a = client.request('x')
    const b = client.request('y')
    await tick()
    reply({ id: 1, error: { code: -1, message: 'nope' } })
    await expect(a).rejects.toThrow('nope')
    client.close(new Error('Codex stopped'))
    await expect(b).rejects.toThrow('Codex stopped')
    await expect(client.request('z')).rejects.toThrow('Codex stopped')
  })

  it('passes notifications to listeners and answers server requests', async () => {
    const seen: string[] = []
    const { client, sent, reply, tick } = pair(async (method) => {
      if (method === 'item/tool/call') return { success: true }
      throw new Error('not supported')
    })
    client.onNotification((method) => seen.push(method))
    reply({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })
    reply({ method: 'item/tool/call', id: 7, params: {} })
    reply({ method: 'item/commandExecution/requestApproval', id: 'a', params: {} })
    await tick()
    expect(seen).toEqual(['item/agentMessage/delta'])
    expect(sent).toContainEqual({ id: 7, result: { success: true } })
    expect(sent).toContainEqual({ id: 'a', error: { code: -32000, message: 'not supported' } })
  })
})
