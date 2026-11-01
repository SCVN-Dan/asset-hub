// Renders many VFX prefabs the way the grid draws their cards (window.assetHubRender) and lays them
// out on one page, to see at a glance which ones draw wrong, and to compare before / after a change.
// Needs `npm run build` first and a signed-in test copy of the app's data (see scripts/ai-eval/run.mjs):
//   ASSETHUB_USER_DATA=… node scripts/vfx-sheet.mjs <list.json: {group: [repo paths]}> <out dir> [max per group]
// Repo, branch and project root are below.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [listFile, outDir, maxArg] = process.argv.slice(2)
const REPO = 'supercent-io/hb_creative_xp_hero'
const BRANCH = 'main'
const ROOT = 'unity_project/hb_creative_xp_hero/'
const max = Number(maxArg) || Infinity
const groups = JSON.parse(readFileSync(listFile, 'utf8'))
mkdirSync(join(outDir, 'img'), { recursive: true })

const APP = process.env.APP_DIR || new URL('..', import.meta.url).pathname
let app, page
/** Starts the app (again, after an effect brought its renderer down), signed in, the branch's tree read. */
async function launch() {
  await app?.close().catch(() => {})
  app = await electron.launch({ executablePath: `${APP}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: [APP], env: { ...process.env }, timeout: 60000 })
  page = await app.firstWindow()
  page.on('console', (m) => m.type() === 'error' && /shader|WebGL|GL_/i.test(m.text()) && console.log('  gl:', m.text().slice(0, 300)))
  // Signed in (restored from the copied settings) before anything is read from GitHub.
  for (let i = 0; ; i++) {
    if (await page.evaluate(() => window.api.auth.status().then((r) => r.ok && r.data.signedIn))) break
    if (i > 60) throw new Error('not signed in after 60 s')
    await new Promise((r) => setTimeout(r, 1000))
  }
  // The branch's file tree first, as opening it in the app does: resolving dependencies needs it.
  const tree = await page.evaluate(([repo, branch]) => window.api.source.listTree(repo, branch).then((r) => (r.ok ? r.data.length ?? 'ok' : r.error.message)), [REPO, BRANCH])
  console.log('tree:', tree)
}
await launch()

const done = new Set()
const cards = []
for (const [group, paths] of Object.entries(groups)) {
  for (const full of paths.slice(0, max)) {
    const path = full
    const id = cards.length
    if (done.has(full)) {
      cards.push({ group, path, ref: [...done].indexOf(full) })
      continue
    }
    done.add(full)
    const t = Date.now()
    let r
    try {
      r = await page.evaluate(([repo, branch, root, path]) => window.assetHubRender(repo, branch, root, path).then((x) => ({ url: x.url }), (e) => ({ error: String(e) })), [REPO, BRANCH, ROOT, path])
    } catch (e) {
      // The renderer went down with this one: noted, and the app started again for the rest.
      r = { error: 'crashed the renderer: ' + String(e).split('\n')[0] }
      await launch()
    }
    const file = `img/${id}.webp`
    if (r.url) writeFileSync(join(outDir, file), Buffer.from(r.url.split(',')[1], 'base64'))
    cards.push({ group, path, file: r.url ? file : undefined, error: r.error, ms: Date.now() - t })
    console.log(`${r.error ? 'ERR ' : 'ok  '} ${group} ${path} ${Date.now() - t}ms ${r.error ?? ''}`)
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const html = `<!doctype html><meta charset="utf-8"><title>VFX sheet</title>
<style>body{margin:0;padding:16px;background:#111;color:#ddd;font:12px system-ui}h2{margin:24px 0 8px}div.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
figure{margin:0;background:#1a1e26;border-radius:6px;overflow:hidden}img{width:100%;display:block;aspect-ratio:4/3;object-fit:contain}figcaption{padding:4px 6px;word-break:break-all;color:#aaa}.err{color:#f77}</style>
${Object.keys(groups).map((g) => `<h2>${esc(g)}</h2><div class="g">${cards.filter((c) => c.group === g).map((c) => `<figure>${c.file ? `<img src="${c.file}" loading="lazy">` : `<div class="err">${esc(c.error ?? 'same as above')}</div>`}<figcaption>${esc(c.path.split('/').pop())}</figcaption></figure>`).join('')}</div>`).join('')}`
writeFileSync(join(outDir, 'index.html'), html)
console.log(`\n${cards.length} cards → ${join(outDir, 'index.html')}`)
await app.close()
