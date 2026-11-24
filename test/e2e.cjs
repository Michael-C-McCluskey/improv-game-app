// End-to-end smoke test: plays a full 2-player round and asserts zero external network requests.
// Usage: node test/e2e.cjs [--screenshots]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.argv.includes('--screenshots');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      p = p.replace(/^\/improv-game-app/, '');
      if (p === '/' || p === '') p = '/index.html';
      const f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function assert(c, msg) { if (!c) throw new Error('ASSERT FAILED: ' + msg); console.log('  ok -', msg); }

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/improv-game-app/`;
  let browser;
  try {
    browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  } catch (e) {
    srv.close();
    console.error(e.message || e);
    process.exit(1);
  }
  const external = [];
  const errors = [];
  const shotDir = path.join(ROOT, 'docs', 'screenshots');
  if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
    await ctx.route('**/*', (route) => { const u = route.request().url(); return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort(); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const tid = (id) => page.locator(`[data-testid="${id}"]`);

    console.log('Setup');
    await page.goto(base);
    const inputs = tid('player-name-input');
    assert(await inputs.count() >= 2, 'at least 2 player inputs');
    await inputs.nth(0).fill('Michael');
    await inputs.nth(1).fill('Anna');
    while (await inputs.count() > 2) {
      const rm = page.locator('[data-testid="remove-player"]');
      if (await rm.count()) await rm.last().click(); else break;
    }
    if (SHOTS) await page.waitForTimeout(1200), await page.screenshot({ path: path.join(shotDir, 'phone-1-setup.png') });
    await tid('start-game').click();

    console.log('Pick game');
    const cards = tid('game-card');
    const n = await cards.count();
    assert(n >= 4 && n <= 6, `4-6 games (got ${n})`);
    await cards.first().click();

    console.log('Scene');
    for (const k of ['prompt-character', 'prompt-place', 'prompt-situation', 'prompt-line']) {
      const t = (await tid(k).first().innerText()).trim();
      assert(t.length > 2, `${k} shows text`);
    }
    const cur = (await tid('current-player').first().innerText());
    assert(/Michael|Anna/.test(cur), 'current player shown: ' + cur.trim().replace(/\s+/g, ' '));
    const t0 = (await tid('timer-display').innerText()).trim();
    await tid('timer-start').click();
    await page.waitForTimeout(2300);
    const t1 = (await tid('timer-display').innerText()).trim();
    assert(t0 !== t1, `timer counts down (${t0} -> ${t1})`);
    if (SHOTS) await page.waitForTimeout(1200), await page.screenshot({ path: path.join(shotDir, 'phone-2-scene.png') });
    await tid('timer-pause').click();
    await tid('scene-done').click();

    console.log('Vote');
    // Each player votes for Anna (index 1): tap option then submit, repeated per voter.
    for (let v = 0; v < 2; v++) {
      await tid('vote-option').nth(1).click();
      await tid('vote-submit').click();
    }

    console.log('Scoreboard');
    await tid('scoreboard').waitFor({ state: 'visible', timeout: 5000 });
    const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__improv.state)));
    const players = st.players || [];
    const anna = players.find((p) => /Anna/.test(p.name || p));
    const score = (p) => (typeof p === 'object' ? (p.score ?? 0) : 0);
    const total = players.reduce((s, p) => s + score(p), 0);
    const sbText = await tid('scoreboard').innerText();
    assert(/Anna/.test(sbText) && /Michael/.test(sbText), 'scoreboard lists both players');
    assert((anna && score(anna) >= 1) || /Anna[\s\S]*?[1-9]/.test(sbText), 'Anna has points after vote');
    assert(total >= 1, 'total points > 0');
    if (SHOTS) await page.waitForTimeout(1200), await page.screenshot({ path: path.join(shotDir, 'phone-3-scoreboard.png') });

    console.log('Persistence');
    await page.reload();
    const st2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__improv.state)));
    assert(JSON.stringify((st2.players || []).map((p) => [p.name, p.score])) === JSON.stringify(players.map((p) => [p.name, p.score])), 'players and scores persisted across reload');
    assert(await tid('next-round').isVisible(), 'results screen restored after reload');

    console.log('Next round');
    await tid('next-round').click();
    assert(await tid('game-card').count() >= 4, 'next round returns to game picker');
    const st3 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__improv.state)));
    assert(st3.starter === 1, 'starter rotates to Anna for round 2');

    if (SHOTS) {
      console.log('TV mode');
      const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await tv.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort());
      tv.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:')) external.push(u); });
      const p2 = await tv.newPage();
      p2.on('pageerror', (e) => errors.push(String(e)));
      await p2.goto(base);
      const t = (id) => p2.locator(`[data-testid="${id}"]`);
      await t('player-name-input').nth(0).fill('Michael');
      await t('player-name-input').nth(1).fill('Anna');
      await t('start-game').click();
      await t('game-card').nth(2).click();
      if (!(await p2.evaluate(() => document.documentElement.className + document.body.className)).includes('tv')) await t('tv-toggle').first().click();
      await p2.waitForTimeout(1200);
      await p2.screenshot({ path: path.join(shotDir, 'tv-landscape-1280x720.png') });
    }

    assert(external.length === 0, `zero external network requests (${external.join(', ') || 'none'})`);
    assert(errors.length === 0, `zero page/console errors (${errors.join(' | ') || 'none'})`);
    console.log('\nPASS: full 2-player round');
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
