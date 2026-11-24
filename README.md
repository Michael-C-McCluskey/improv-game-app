# 🎭 Improv Night

A tiny phone-first improv party game for 2-4 players. Plain HTML/CSS/vanilla JS: no build step, no dependencies, no backend, no network calls, no tracking.

## Play
Open `index.html` in any browser (or the GitHub Pages link once published). Enter names, pick a game, act out the random prompts against the timer, vote, and watch the scoreboard.

**Games:** Yes, And... · One-Word Story · Emotion Switch · Party Quirks · Alphabet Scene · Freeze Swap

- Random characters, places, situations and first lines (kid-friendly), with reroll
- Adjustable round timer (0:30-5:00) with vibration + visual "Time's up!"
- Turn rotation, tap-to-vote or quick award, scoreboard across rounds
- 📺 TV mode: huge landscape text for screen mirroring
- Players, scores and settings saved in the browser (localStorage)

## Test
```sh
npm install --no-save playwright && npx playwright install chromium
node test/e2e.cjs            # plays a full 2-player round, asserts zero external requests
node test/e2e.cjs --screenshots   # also writes docs/screenshots/*.png
```
CI runs the same test on every PR (`.github/workflows/e2e.yml`).

## Go public (only with Michael's OK)
```sh
gh repo edit Michael-C-McCluskey/improv-game-app --visibility public --accept-visibility-change-consequences
gh api -X POST repos/Michael-C-McCluskey/improv-game-app/pages -f "source[branch]=main" -f "source[path]=/"
gh api repos/Michael-C-McCluskey/improv-game-app/pages --jq .html_url   # check status
```
Expected URL: https://michael-c-mccluskey.github.io/improv-game-app/
