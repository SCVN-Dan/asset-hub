// Runs the AI pet against eval cases and scores each on the first ask: found when an expected
// name is in the grid, the answer or the opened asset. Needs `npm run build` first, and a test
// copy of the app's data (signed in to GitHub and ChatGPT) so the installed app can stay open:
//   ASSETHUB_USER_DATA=<copy of ~/Library/Application Support/asset-hub, without Singleton*>
//   node scripts/ai-eval/run.mjs scripts/ai-eval/cases-vi.json results-vi.json [only indexes, e.g. 0,3,5]
// Set the copy's settings.json "language" to the cases' language, and "usageStats": false.
import { _electron as electron } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'

const [casesFile, outFile, only] = process.argv.slice(2)
const cases = JSON.parse(readFileSync(casesFile, 'utf8'))
const pick = only ? only.split(',').map(Number) : cases.map((_, i) => i)
const APP = new URL('../..', import.meta.url).pathname
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({ executablePath: `${APP}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: [APP], env: { ...process.env }, timeout: 60000 })
const page = await app.firstWindow()
await page.evaluate(() => new Promise((r) => { const t = Date.now(); const i = setInterval(() => { const a = document.querySelector('.ai-pet-avatar'); if (a || Date.now() - t > 40000) { clearInterval(i); a?.click(); r() } }, 300) }))
await page.evaluate(() => {
  window.__calls = []
  window.api.ai.onToolCall((c) => window.__calls.push(`${c.tool} ${JSON.stringify(c.args)}`))
})

/** Sends `text`, waits for the answer, returns what the hub and the pet show. */
const ask = (text) =>
  page.evaluate(
    (text) =>
      new Promise((resolve) => {
        const input = document.querySelector('.ai-pet-input .input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => {
          input.form.requestSubmit()
          const t = Date.now()
          const i = setInterval(() => {
            if ((!document.querySelector('.ai-pet[data-busy]') && Date.now() - t > 800) || Date.now() - t > 120000) {
              clearInterval(i)
              setTimeout(() => {
                const msgs = [...document.querySelectorAll('.ai-msg-assistant')]
                resolve({
                  secs: Math.round((Date.now() - t) / 1000),
                  answer: msgs[msgs.length - 1]?.textContent ?? '',
                  choices: [...document.querySelectorAll('.ai-choice')].map((b) => b.textContent),
                  search: document.querySelector('.search input')?.value ?? '',
                  grid: [...document.querySelectorAll('.asset-card .asset-name')].slice(0, 24).map((e) => e.textContent),
                  opened: document.querySelector('.details h2, .asset-details h2')?.textContent ?? ''
                })
              }, 600)
            }
          }, 250)
        }, 100)
      }),
    text
  )

const results = []
for (const i of pick) {
  const c = cases[i]
  // A new conversation per case, so earlier ones do not steer it.
  await page.evaluate(() => [...document.querySelectorAll('.ai-pet-icon')].find((b) => b.getAttribute('aria-label') && b.querySelector('path[d^="M12 5"]'))?.click())
  await sleep(400)
  await page.evaluate(() => (window.__calls = []))
  const r = await ask(c.q)
  const re = new RegExp(c.expect, 'i')
  const hit = [...r.grid, r.answer, r.opened].some((s) => re.test(s))
  const calls = await page.evaluate(() => window.__calls)
  results.push({ i, q: c.q, expect: c.expect, pass: hit, asked: r.choices.length > 0, ...r, calls })
  console.log(`${hit ? 'PASS' : 'FAIL'} #${i} ${r.secs}s ${r.choices.length ? '(asked) ' : ''}${c.q} | search="${r.search}" | ${r.answer.slice(0, 110)}`)
  writeFileSync(outFile, JSON.stringify(results, null, 1))
}
const passed = results.filter((r) => r.pass).length
const avg = Math.round(results.reduce((s, r) => s + r.secs, 0) / results.length)
console.log(`\n${passed}/${results.length} found on the first ask · ${results.filter((r) => r.asked).length} asked back · avg ${avg}s`)
await app.close()
