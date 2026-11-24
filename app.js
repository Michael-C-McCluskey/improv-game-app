/* Improv Night — vanilla JS, no network, no dependencies. */
(function () {
  'use strict';

  var P = window.IMPROV_PROMPTS;
  var SAVE_SLOT = 'improv-night-v1';
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 4;
  var T_MIN = 30;
  var T_MAX = 300;
  var T_STEP = 15;
  var T_DEFAULT = 90;

  var GAMES = [
    {
      id: 'yes-and', emoji: '🤝', name: 'Yes, And...',
      tagline: 'Accept every idea and build on it. No blocking!',
      rules: [
        'Every line starts with “Yes, and…”',
        'Whatever your partner says is true',
        'Add one new detail each time',
        'Said “No” or “But”? Laugh and start a new line'
      ]
    },
    {
      id: 'one-word', emoji: '📖', name: 'One-Word Story',
      tagline: 'Tell a story together, one word at a time.',
      rules: [
        'Take turns saying ONE word each',
        'Use the prompts as your story idea',
        'Keep it quick and don’t plan ahead',
        'End together with “The… End!”'
      ]
    },
    {
      id: 'emotion-switch', emoji: '🎭', name: 'Emotion Switch',
      tagline: 'Same scene, new feelings. Switch on command!',
      rules: [
        'Play the scene with the emotion shown',
        'Anyone can tap “Switch!” for a new one',
        'Change instantly but keep the story going',
        'Go big. Over the top is perfect'
      ]
    },
    {
      id: 'party-quirks', emoji: '🎉', name: 'Party Quirks',
      tagline: 'Host a party where every guest is a little odd.',
      rules: [
        'The starter is the party host (no peeking!)',
        'Guests secretly read their quirk',
        'Guests act out their quirk while chatting',
        'Host guesses each quirk before time runs out'
      ]
    },
    {
      id: 'alphabet', emoji: '🔤', name: 'Alphabet Scene',
      tagline: 'Each line starts with the next letter of the alphabet.',
      rules: [
        'First line starts with the letter shown',
        'Each new line starts with the next letter',
        'After Z, wrap back around to A',
        'Stuck? Make it silly and keep going'
      ]
    },
    {
      id: 'freeze-swap', emoji: '🧊', name: 'Freeze Swap',
      tagline: 'Freeze mid-scene, swap places, start something new.',
      rules: [
        'Act out the scene with big movements',
        'Anyone shouts “Freeze!” and everyone stops',
        'Swap places and copy the frozen pose',
        'Start a brand-new scene from that pose'
      ]
    }
  ];

  var PROMPT_KEYS = [
    { key: 'character', list: 'characters', label: 'Character', icon: '🧑' },
    { key: 'place', list: 'places', label: 'Place', icon: '📍' },
    { key: 'situation', list: 'situations', label: 'Situation', icon: '💥' },
    { key: 'line', list: 'firstLines', label: 'First line', icon: '💬' }
  ];

  // ---------- State ----------
  var state = {
    players: [],          // [{ name, score }]
    round: 0,             // rounds completed
    starter: 0,           // index of the player who starts this round
    screen: 'setup',      // setup | picker | scene | vote | results
    draft: null,          // setup screen draft [{ name, score }]
    gameId: null,
    prompts: null,        // { character, place, situation, line }
    extras: [],           // game-specific prompts
    rulesOpen: true,
    timer: { remainingMs: T_DEFAULT * 1000, running: false },
    vote: { mode: 'vote', voter: 0, selected: null, votes: [], awards: [] },
    lastRound: null,      // { round, gameId, points: [] }
    settings: { tvMode: false, timerLength: T_DEFAULT }
  };

  window.__improv = { state: state, games: GAMES };

  var endAt = 0;
  var tickId = null;
  var flashTimeout = null;
  var wakeLock = null;
  var audioCtx = null;
  var lastScreen = null;
  var popKey = null;

  // ---------- Helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function pickDifferent(list, current, avoid) {
    var pool = list.filter(function (x) { return x !== current && (!avoid || avoid.indexOf(x) === -1); });
    if (!pool.length) pool = list.filter(function (x) { return x !== current; });
    return pool.length ? pick(pool) : pick(list);
  }
  function getGame(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return null;
  }
  function playerName(i) { return state.players[i] ? state.players[i].name : ''; }
  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function timerLength() { return state.settings.timerLength; }
  function defaultName(i) { return 'Player ' + (i + 1); }

  // ---------- Storage ----------
  function save() {
    try {
      var snapshot = JSON.parse(JSON.stringify(state));
      snapshot.timer.running = false;
      if (state.timer.running) snapshot.timer.remainingMs = Math.max(0, endAt - Date.now());
      localStorage.setItem(SAVE_SLOT, JSON.stringify(snapshot));
    } catch (e) { /* storage unavailable: play on without saving */ }
  }

  function load() {
    var data;
    try {
      var raw = localStorage.getItem(SAVE_SLOT);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch (e) { return; }
    if (!data || typeof data !== 'object') return;

    if (data.settings && typeof data.settings === 'object') {
      state.settings.tvMode = !!data.settings.tvMode;
      var tl = Number(data.settings.timerLength);
      if (isFinite(tl)) state.settings.timerLength = clamp(Math.round(tl / T_STEP) * T_STEP, T_MIN, T_MAX);
    }
    state.timer.remainingMs = timerLength() * 1000;

    var players = Array.isArray(data.players) ? data.players.filter(function (p) {
      return p && typeof p.name === 'string';
    }).slice(0, MAX_PLAYERS).map(function (p) {
      var sc = Number(p.score);
      return { name: p.name.slice(0, 24) || 'Player', score: isFinite(sc) ? Math.max(0, Math.round(sc)) : 0 };
    }) : [];

    if (players.length < MIN_PLAYERS) return; // nothing to resume, keep settings only
    state.players = players;
    var n = players.length;
    state.round = Math.max(0, Math.round(Number(data.round)) || 0);
    state.starter = clamp(Math.round(Number(data.starter)) || 0, 0, n - 1);
    state.rulesOpen = data.rulesOpen !== false;
    state.lastRound = null;
    if (data.lastRound && Array.isArray(data.lastRound.points) && data.lastRound.points.length === n) {
      state.lastRound = {
        round: Number(data.lastRound.round) || state.round,
        gameId: getGame(data.lastRound.gameId) ? data.lastRound.gameId : null,
        points: data.lastRound.points.map(function (x) { return Math.max(0, Number(x) || 0); })
      };
    }

    var screen = data.screen;
    var game = getGame(data.gameId);
    var promptsOk = data.prompts && PROMPT_KEYS.every(function (k) { return typeof data.prompts[k.key] === 'string'; });

    if ((screen === 'scene' || screen === 'vote') && game && promptsOk) {
      state.gameId = game.id;
      state.prompts = data.prompts;
      state.extras = Array.isArray(data.extras) ? data.extras.filter(function (x) {
        return x && typeof x.value === 'string' && P[x.list];
      }) : buildExtras(game.id);
      var ms = data.timer ? Number(data.timer.remainingMs) : NaN;
      state.timer.remainingMs = isFinite(ms) ? clamp(ms, 0, timerLength() * 1000) : timerLength() * 1000;
      state.screen = screen;
      if (screen === 'vote') {
        var v = data.vote || {};
        state.vote = {
          mode: v.mode === 'quick' ? 'quick' : 'vote',
          voter: 0, selected: null, votes: [], awards: []
        };
        if (Array.isArray(v.votes)) {
          state.vote.votes = v.votes.map(Number).filter(function (x) { return x >= 0 && x < n; }).slice(0, n);
        }
        state.vote.voter = state.vote.votes.length;
        state.vote.awards = Array.isArray(v.awards) && v.awards.length === n
          ? v.awards.map(function (x) { return Math.max(0, Number(x) || 0); })
          : zeros(n);
        if (state.vote.voter >= n) { state.vote.votes = []; state.vote.voter = 0; }
      }
    } else if (screen === 'results' && state.lastRound) {
      state.screen = 'results';
    } else if (screen === 'setup') {
      state.screen = 'setup';
      state.draft = null;
    } else {
      state.screen = 'picker';
    }
  }

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }

  // ---------- Game setup ----------
  function buildPrompts() {
    var p = {};
    PROMPT_KEYS.forEach(function (k) { p[k.key] = pick(P[k.list]); });
    return p;
  }

  function buildExtras(gameId) {
    switch (gameId) {
      case 'emotion-switch':
        return [{ key: 'emotion', label: 'Emotion', icon: '😮', list: 'emotions', value: pick(P.emotions), reroll: 'Switch!' }];
      case 'party-quirks': {
        var used = [];
        var out = [];
        for (var i = 0; i < state.players.length; i++) {
          if (i === state.starter) continue;
          var q = pickDifferent(P.quirks, null, used);
          used.push(q);
          out.push({ key: 'quirk', owner: i, label: playerName(i) + '’s secret quirk', icon: '🤫', list: 'quirks', value: q, secret: true, revealed: false });
        }
        return out;
      }
      case 'alphabet':
        return [{ key: 'letter', label: 'Start letter', icon: '🔤', list: 'letters', value: pick(P.letters) }];
      case 'freeze-swap':
        return [{ key: 'pose', label: 'Opening pose', icon: '🧍', list: 'poses', value: pick(P.poses) }];
      default:
        return [];
    }
  }

  function nextLetters(letter) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var i = A.indexOf(letter);
    if (i < 0) return '';
    return [1, 2, 3].map(function (d) { return A[(i + d) % 26]; }).join(', ');
  }

  // ---------- Timer ----------
  function startTimer() {
    if (state.timer.running) return;
    unlockAudio();
    hideFlash();
    if (state.timer.remainingMs <= 0) state.timer.remainingMs = timerLength() * 1000;
    endAt = Date.now() + state.timer.remainingMs;
    state.timer.running = true;
    clearInterval(tickId);
    tickId = setInterval(tick, 200);
    requestWakeLock();
    updateTimerUI();
    save();
  }

  function pauseTimer() {
    if (!state.timer.running) return;
    state.timer.remainingMs = Math.max(0, endAt - Date.now());
    state.timer.running = false;
    clearInterval(tickId);
    tickId = null;
    releaseWakeLock();
    updateTimerUI();
    save();
  }

  function resetTimer() {
    state.timer.running = false;
    clearInterval(tickId);
    tickId = null;
    releaseWakeLock();
    hideFlash();
    state.timer.remainingMs = timerLength() * 1000;
    updateTimerUI();
    save();
  }

  function adjustTimer(dir) {
    var oldLen = timerLength();
    var newLen = clamp(oldLen + dir * T_STEP, T_MIN, T_MAX);
    if (newLen === oldLen) return;
    var deltaMs = (newLen - oldLen) * 1000;
    state.settings.timerLength = newLen;
    if (state.timer.running) {
      var rem = clamp(endAt - Date.now() + deltaMs, 1000, newLen * 1000);
      endAt = Date.now() + rem;
      state.timer.remainingMs = rem;
    } else if (state.timer.remainingMs >= oldLen * 1000 || state.timer.remainingMs <= 0) {
      state.timer.remainingMs = newLen * 1000; // untouched or finished: show the new full length
    } else {
      state.timer.remainingMs = clamp(state.timer.remainingMs + deltaMs, 1000, newLen * 1000);
    }
    updateTimerUI();
    save();
  }

  function tick() {
    if (!state.timer.running) return;
    var rem = endAt - Date.now();
    if (rem <= 0) {
      state.timer.remainingMs = 0;
      state.timer.running = false;
      clearInterval(tickId);
      tickId = null;
      releaseWakeLock();
      updateTimerUI();
      timesUp();
      save();
      return;
    }
    state.timer.remainingMs = rem;
    updateTimerUI();
  }

  function stopTimerSilently() {
    if (state.timer.running) {
      state.timer.remainingMs = Math.max(0, endAt - Date.now());
      state.timer.running = false;
    }
    clearInterval(tickId);
    tickId = null;
    releaseWakeLock();
    hideFlash();
  }

  function timesUp() {
    try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 600]); } catch (e) { /* ignore */ }
    beep();
    var flash = document.getElementById('flash');
    if (!flash) return;
    flash.hidden = false;
    document.body.classList.add('flashing');
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(hideFlash, 4000);
  }

  function hideFlash() {
    clearTimeout(flashTimeout);
    var flash = document.getElementById('flash');
    if (flash) flash.hidden = true;
    document.body.classList.remove('flashing');
  }

  function unlockAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
    } catch (e) { audioCtx = null; }
  }

  function beep() {
    try {
      if (!audioCtx) return;
      var t = audioCtx.currentTime;
      [0, 0.3, 0.6].forEach(function (o, idx) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = idx === 2 ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, t + o);
        g.gain.exponentialRampToValueAtTime(0.35, t + o + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + o + 0.25);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(t + o);
        osc.stop(t + o + 0.27);
      });
    } catch (e) { /* ignore */ }
  }

  function requestWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (lock) {
          if (!state.timer.running) { lock.release().catch(function () {}); return; }
          wakeLock = lock;
          lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
        }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function releaseWakeLock() {
    try { if (wakeLock) { var l = wakeLock; wakeLock = null; l.release().catch(function () {}); } } catch (e) { wakeLock = null; }
  }

  function updateTimerUI() {
    var disp = document.querySelector('[data-testid="timer-display"]');
    if (!disp) return;
    var rem = state.timer.remainingMs;
    var len = timerLength() * 1000;
    disp.textContent = fmtTime(rem);
    var card = document.getElementById('timer-card');
    if (card) {
      card.classList.toggle('is-running', state.timer.running);
      card.classList.toggle('is-low', state.timer.running && rem <= 10000);
      card.classList.toggle('is-done', !state.timer.running && rem <= 0);
    }
    var bar = document.getElementById('timer-bar');
    if (bar) bar.style.transform = 'scaleX(' + clamp(rem / len, 0, 1) + ')';
    var lenLabel = document.getElementById('timer-length');
    if (lenLabel) lenLabel.textContent = fmtTime(len);
    var startBtn = document.querySelector('[data-testid="timer-start"]');
    var pauseBtn = document.querySelector('[data-testid="timer-pause"]');
    if (startBtn) {
      startBtn.disabled = state.timer.running;
      startBtn.textContent = rem > 0 && rem < len ? '▶ Resume' : '▶ Start';
    }
    if (pauseBtn) pauseBtn.disabled = !state.timer.running;
    var minus = document.querySelector('[data-testid="timer-minus"]');
    var plus = document.querySelector('[data-testid="timer-plus"]');
    if (minus) minus.disabled = timerLength() <= T_MIN;
    if (plus) plus.disabled = timerLength() >= T_MAX;
  }

  // ---------- Rendering ----------
  function render() {
    var root = document.getElementById('screen');
    var html;
    switch (state.screen) {
      case 'picker': html = renderPicker(); break;
      case 'scene': html = renderScene(); break;
      case 'vote': html = renderVote(); break;
      case 'results': html = renderResults(); break;
      default: state.screen = 'setup'; html = renderSetup();
    }
    root.innerHTML = html;
    root.setAttribute('data-screen', state.screen);

    if (state.screen !== lastScreen) {
      root.classList.remove('enter');
      void root.offsetWidth; // restart entrance animation
      root.classList.add('enter');
      window.scrollTo(0, 0);
      lastScreen = state.screen;
    }
    if (popKey) {
      var el = root.querySelector('[data-pop="' + popKey + '"]');
      if (el) el.classList.add('pop');
      popKey = null;
    }

    var badge = document.getElementById('round-badge');
    if (state.players.length && state.screen !== 'setup') {
      badge.hidden = false;
      badge.textContent = state.screen === 'results' ? 'Round ' + state.round + ' done' : 'Round ' + (state.round + 1);
    } else {
      badge.hidden = true;
    }
    applyTv();
    if (state.screen === 'scene') updateTimerUI();
  }

  function renderSetup() {
    if (!state.draft) {
      state.draft = state.players.length
        ? state.players.map(function (p) { return { name: p.name, score: p.score }; })
        : [{ name: defaultName(0), score: 0 }, { name: defaultName(1), score: 0 }];
    }
    var d = state.draft;
    var editing = state.players.length > 0;
    var rows = d.map(function (p, i) {
      return '<li class="player-row">' +
        '<span class="player-num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<label class="sr-only" for="pname-' + i + '">Player ' + (i + 1) + ' name</label>' +
        '<input id="pname-' + i + '" class="text-input" type="text" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done"' +
        ' data-testid="player-name-input" data-index="' + i + '" value="' + esc(p.name) + '" placeholder="' + defaultName(i) + '">' +
        (d.length > MIN_PLAYERS
          ? '<button type="button" class="icon-btn remove" data-action="remove-player" data-index="' + i + '" data-testid="remove-player" aria-label="Remove ' + esc(p.name || defaultName(i)) + '">✕</button>'
          : '') +
        '</li>';
    }).join('');

    return '<section class="card hero">' +
      '<h1 class="title">Who’s playing?</h1>' +
      '<p class="muted">2–4 players. Tap a name to change it.</p>' +
      '<ul class="player-list">' + rows + '</ul>' +
      '<button type="button" class="btn ghost" data-action="add-player" data-testid="add-player"' + (d.length >= MAX_PLAYERS ? ' disabled' : '') + '>＋ Add player</button>' +
      '</section>' +
      '<div class="actions">' +
      '<button type="button" class="btn primary big" data-action="start-game" data-testid="start-game">' + (editing ? 'Save & continue ▶' : 'Start ▶') + '</button>' +
      (editing ? '<button type="button" class="btn ghost" data-action="cancel-setup">Cancel</button>' : '') +
      '</div>';
  }

  function renderPicker() {
    var cards = GAMES.map(function (g) {
      return '<li><button type="button" class="game-card" data-action="pick-game" data-testid="game-card" data-game="' + g.id + '">' +
        '<span class="game-emoji" aria-hidden="true">' + g.emoji + '</span>' +
        '<span class="game-text"><span class="game-name">' + esc(g.name) + '</span>' +
        '<span class="game-tag">' + esc(g.tagline) + '</span></span>' +
        '</button></li>';
    }).join('');
    return '<section class="card banner">' +
      '<p class="kicker">Round ' + (state.round + 1) + '</p>' +
      '<p class="starter" data-testid="current-player">' + esc(playerName(state.starter)) + ' starts!</p>' +
      '<p class="muted">Pick a game to play.</p>' +
      '</section>' +
      '<ul class="game-grid">' + cards + '</ul>' +
      '<div class="actions row">' +
      '<button type="button" class="btn secondary" data-action="random-game" data-testid="random-game">🎲 Surprise me</button>' +
      '<button type="button" class="btn ghost" data-action="edit-players" data-testid="edit-players">✏️ Players</button>' +
      '</div>' +
      (state.round > 0 ? renderScoreboard(true) : '');
  }

  function renderPromptRow(k, value) {
    return '<div class="prompt" data-pop="' + k.key + '">' +
      '<div class="prompt-text"><span class="prompt-label"><span aria-hidden="true">' + k.icon + '</span> ' + k.label + '</span>' +
      '<span class="prompt-value" data-testid="prompt-' + k.key + '">' + esc(value) + '</span></div>' +
      '<button type="button" class="icon-btn" data-action="reroll" data-key="' + k.key + '" data-testid="reroll-' + k.key + '" aria-label="New ' + k.label.toLowerCase() + '">🎲</button>' +
      '</div>';
  }

  function renderExtra(x, i) {
    var hidden = x.secret && !x.revealed;
    var value = hidden ? '<span class="secret">Tap 👁 to peek (host, look away!)</span>' : esc(x.value);
    var hint = x.key === 'letter' ? '<span class="prompt-hint">then ' + nextLetters(x.value) + '…</span>' : '';
    var btns = '';
    if (x.secret) {
      btns += '<button type="button" class="icon-btn" data-action="reveal" data-index="' + i + '" data-testid="reveal-extra" aria-label="' + (hidden ? 'Show' : 'Hide') + ' quirk" aria-pressed="' + (!hidden) + '">' + (hidden ? '👁' : '🙈') + '</button>';
    }
    btns += x.reroll
      ? '<button type="button" class="btn switch" data-action="reroll-extra" data-index="' + i + '" data-testid="reroll-extra">' + esc(x.reroll) + '</button>'
      : '<button type="button" class="icon-btn" data-action="reroll-extra" data-index="' + i + '" data-testid="reroll-extra" aria-label="New ' + esc(x.label.toLowerCase()) + '">🎲</button>';
    return '<div class="prompt extra' + (x.key === 'letter' ? ' letter' : '') + '" data-pop="extra-' + i + '">' +
      '<div class="prompt-text"><span class="prompt-label"><span aria-hidden="true">' + x.icon + '</span> ' + esc(x.label) + '</span>' +
      '<span class="prompt-value" data-testid="prompt-' + x.key + '">' + value + '</span>' + hint + '</div>' +
      '<div class="prompt-btns">' + btns + '</div>' +
      '</div>';
  }

  function renderScene() {
    var g = getGame(state.gameId);
    var rules = g.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    var prompts = PROMPT_KEYS.map(function (k) { return renderPromptRow(k, state.prompts[k.key]); }).join('');
    var extras = state.extras.map(renderExtra).join('');
    var sub = g.id === 'party-quirks'
      ? '<p class="muted">' + esc(playerName(state.starter)) + ' is the host.</p>'
      : '';
    return '<div class="scene-grid">' +
      '<div class="col">' +
      '<section class="card scene-head">' +
      '<p class="kicker"><span aria-hidden="true">' + g.emoji + '</span> ' + esc(g.name) + '</p>' +
      '<p class="starter" data-testid="current-player">' + esc(playerName(state.starter)) + ' starts!</p>' + sub +
      '<details class="rules"' + (state.rulesOpen ? ' open' : '') + ' data-testid="rules">' +
      '<summary>How to play</summary><ol>' + rules + '</ol></details>' +
      '</section>' +
      (extras ? '<section class="card prompts extras">' + extras + '</section>' : '') +
      '<section class="card prompts">' + prompts + '</section>' +
      '</div>' +
      '<div class="col">' +
      '<section class="card timer" id="timer-card">' +
      '<div class="timer-display" data-testid="timer-display" role="timer" aria-live="off">' + fmtTime(state.timer.remainingMs) + '</div>' +
      '<div class="timer-track" aria-hidden="true"><div class="timer-bar" id="timer-bar"></div></div>' +
      '<div class="timer-len">' +
      '<button type="button" class="icon-btn" data-action="timer-minus" data-testid="timer-minus" aria-label="15 seconds shorter">−15s</button>' +
      '<span>Length <strong id="timer-length">' + fmtTime(timerLength() * 1000) + '</strong></span>' +
      '<button type="button" class="icon-btn" data-action="timer-plus" data-testid="timer-plus" aria-label="15 seconds longer">+15s</button>' +
      '</div>' +
      '<div class="timer-btns">' +
      '<button type="button" class="btn primary" data-action="timer-start" data-testid="timer-start">▶ Start</button>' +
      '<button type="button" class="btn secondary" data-action="timer-pause" data-testid="timer-pause">❚❚ Pause</button>' +
      '<button type="button" class="btn ghost" data-action="timer-reset" data-testid="timer-reset">↺ Reset</button>' +
      '</div>' +
      '</section>' +
      '<div class="actions">' +
      '<button type="button" class="btn done big" data-action="scene-done" data-testid="scene-done">✅ Scene done — vote!</button>' +
      '<button type="button" class="btn ghost" data-action="back-to-picker" data-testid="back-to-picker">← Pick another game</button>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  function renderVote() {
    var v = state.vote;
    var n = state.players.length;
    var tabs = '<div class="tabs" role="group" aria-label="Scoring mode">' +
      '<button type="button" class="tab" data-action="vote-mode" data-mode="vote" data-testid="mode-vote" aria-pressed="' + (v.mode === 'vote') + '">🗳️ Everyone votes</button>' +
      '<button type="button" class="tab" data-action="vote-mode" data-mode="quick" data-testid="mode-quick" aria-pressed="' + (v.mode === 'quick') + '">⚡ Quick award</button>' +
      '</div>';
    var body;
    if (v.mode === 'quick') {
      var rows = state.players.map(function (p, i) {
        return '<li class="award-row"><span class="award-name">' + esc(p.name) + '</span>' +
          '<button type="button" class="icon-btn" data-action="award-minus" data-index="' + i + '" data-testid="quick-award-minus" aria-label="Remove a point from ' + esc(p.name) + '"' + (v.awards[i] > 0 ? '' : ' disabled') + '>−</button>' +
          '<span class="award-count" data-testid="quick-award-count">+' + v.awards[i] + '</span>' +
          '<button type="button" class="btn award" data-action="award-plus" data-index="' + i + '" data-testid="quick-award" data-player="' + i + '">+1</button>' +
          '</li>';
      }).join('');
      body = '<section class="card">' +
        '<h2 class="title">Host hands out points</h2>' +
        '<p class="muted">Tap +1 for every great moment.</p>' +
        '<ul class="award-list">' + rows + '</ul>' +
        '</section>' +
        '<div class="actions"><button type="button" class="btn primary big" data-action="quick-done" data-testid="quick-done">Show results 🏆</button></div>';
    } else {
      var voter = v.voter;
      var progress = state.players.map(function (p, i) {
        var cls = i < voter ? 'done' : (i === voter ? 'now' : '');
        return '<li class="' + cls + '">' + (i < voter ? '✓ ' : '') + esc(p.name) + '</li>';
      }).join('');
      var opts = state.players.map(function (p, i) {
        var sel = v.selected === i;
        return '<li><button type="button" class="vote-option" data-action="vote-select" data-testid="vote-option" data-player="' + i + '" aria-pressed="' + sel + '">' +
          '<span class="vote-check" aria-hidden="true">' + (sel ? '⭐' : '') + '</span>' + esc(p.name) +
          (i === voter ? ' <small>(you)</small>' : '') + '</button></li>';
      }).join('');
      body = '<section class="card">' +
        '<p class="kicker">Vote ' + (voter + 1) + ' of ' + n + '</p>' +
        '<h2 class="title" data-testid="current-voter"><span class="hl">' + esc(playerName(voter)) + '</span>, who was funniest?</h2>' +
        '<p class="muted">Pass the phone. Votes stay secret until the end.</p>' +
        '<ul class="voter-progress" aria-label="Voting progress">' + progress + '</ul>' +
        '<ul class="vote-grid">' + opts + '</ul>' +
        '</section>' +
        '<div class="actions"><button type="button" class="btn primary big" data-action="vote-submit" data-testid="vote-submit"' + (v.selected === null ? ' disabled' : '') + '>' +
        (v.selected === null ? 'Tap a name first' : 'Submit vote ✔') + '</button></div>';
    }
    return tabs + body +
      '<div class="actions"><button type="button" class="btn ghost" data-action="back-to-scene" data-testid="back-to-scene">← Back to scene</button></div>';
  }

  function renderScoreboard(compact) {
    var order = state.players.map(function (p, i) { return i; });
    order.sort(function (a, b) { return state.players[b].score - state.players[a].score || a - b; });
    var top = state.players.length ? state.players[order[0]].score : 0;
    var rows = order.map(function (i, rank) {
      var p = state.players[i];
      var leader = top > 0 && p.score === top;
      return '<li class="score-row' + (leader ? ' leader' : '') + '" data-testid="score-row" data-player="' + i + '">' +
        '<span class="rank">' + (leader ? '<span aria-label="Leader">👑</span>' : (rank + 1)) + '</span>' +
        '<span class="score-name">' + esc(p.name) + '</span>' +
        '<span class="score-val" data-testid="score-value">' + p.score + '</span>' +
        '</li>';
    }).join('');
    return '<section class="card scoreboard' + (compact ? ' compact' : '') + '" data-testid="scoreboard">' +
      '<h2 class="title small">Scoreboard</h2>' +
      '<p class="muted" data-testid="round-count">Rounds played: ' + state.round + '</p>' +
      '<ol class="score-list">' + rows + '</ol>' +
      '</section>';
  }

  function renderResults() {
    var lr = state.lastRound;
    var points = lr ? lr.points : zeros(state.players.length);
    var best = Math.max.apply(null, points.concat([0]));
    var winners = [];
    points.forEach(function (pt, i) { if (best > 0 && pt === best) winners.push(i); });
    var headline;
    if (!winners.length) headline = 'No points this round. Tough crowd! 😅';
    else if (winners.length === 1) headline = esc(playerName(winners[0])) + ' wins the round!';
    else headline = 'It’s a tie: ' + winners.map(function (i) { return esc(playerName(i)); }).join(' & ') + '!';
    var g = lr && lr.gameId ? getGame(lr.gameId) : null;
    var pts = state.players.map(function (p, i) {
      return '<li><span>' + esc(p.name) + '</span><strong>+' + points[i] + '</strong></li>';
    }).join('');
    var nextStarter = state.players.length ? (state.starter + 1) % state.players.length : 0;
    return '<section class="card results" data-testid="round-results">' +
      '<div class="trophy" aria-hidden="true">🏆</div>' +
      '<p class="kicker">Round ' + state.round + (g ? ' · ' + esc(g.name) : '') + '</p>' +
      '<h1 class="title">' + headline + '</h1>' +
      '<ul class="round-points">' + pts + '</ul>' +
      '</section>' +
      renderScoreboard(false) +
      '<div class="actions">' +
      '<button type="button" class="btn primary big" data-action="next-round" data-testid="next-round">Next round ▶ <small>' + esc(playerName(nextStarter)) + ' starts</small></button>' +
      '<div class="row">' +
      '<button type="button" class="btn secondary" data-action="new-game" data-testid="new-game">🔄 New game</button>' +
      '<button type="button" class="btn ghost" data-action="edit-players" data-testid="edit-players">✏️ Edit players</button>' +
      '</div></div>';
  }

  function applyTv() {
    var on = !!state.settings.tvMode;
    document.documentElement.classList.toggle('tv', on);
    var btn = document.querySelector('[data-testid="tv-toggle"]');
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'TV mode on' : 'TV mode off';
    }
  }

  // ---------- Actions ----------
  function go(screen) {
    state.screen = screen;
    save();
    render();
  }

  function startScene(gameId) {
    if (!getGame(gameId)) return;
    state.gameId = gameId;
    state.prompts = buildPrompts();
    state.extras = buildExtras(gameId);
    stopTimerSilently();
    state.timer.remainingMs = timerLength() * 1000;
    go('scene');
  }

  function initVote() {
    var n = state.players.length;
    state.vote = { mode: state.vote && state.vote.mode === 'quick' ? 'quick' : 'vote', voter: 0, selected: null, votes: [], awards: zeros(n) };
  }

  function finishRound(points) {
    if (state.screen !== 'vote') return; // guard against double taps
    state.players.forEach(function (p, i) { p.score += points[i] || 0; });
    state.round += 1;
    state.lastRound = { round: state.round, gameId: state.gameId, points: points.slice() };
    state.gameId = null;
    state.prompts = null;
    state.extras = [];
    initVote();
    go('results');
  }

  var actions = {
    'toggle-tv': function () {
      state.settings.tvMode = !state.settings.tvMode;
      applyTv();
      save();
    },
    'dismiss-flash': hideFlash,

    'add-player': function () {
      if (!state.draft || state.draft.length >= MAX_PLAYERS) return;
      state.draft.push({ name: defaultName(state.draft.length), score: 0 });
      render();
      var inputs = document.querySelectorAll('[data-testid="player-name-input"]');
      var last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    },
    'remove-player': function (el) {
      var i = Number(el.getAttribute('data-index'));
      if (!state.draft || state.draft.length <= MIN_PLAYERS || !state.draft[i]) return;
      state.draft.splice(i, 1);
      render();
    },
    'start-game': function () {
      var d = state.draft || [];
      if (d.length < MIN_PLAYERS) return;
      var editing = state.players.length > 0;
      state.players = d.map(function (p, i) {
        return { name: (p.name || '').trim().slice(0, 24) || defaultName(i), score: p.score || 0 };
      });
      state.draft = null;
      if (!editing) { state.round = 0; state.starter = 0; state.lastRound = null; }
      state.starter = clamp(state.starter, 0, state.players.length - 1);
      state.lastRound = null;
      state.gameId = null;
      state.prompts = null;
      state.extras = [];
      initVote();
      go('picker');
    },
    'cancel-setup': function () {
      state.draft = null;
      go(state.players.length ? 'picker' : 'setup');
    },
    'edit-players': function () {
      stopTimerSilently();
      if (state.screen === 'results' && state.players.length) {
        // Leaving the results screen counts as moving on to the next round.
        state.starter = (state.starter + 1) % state.players.length;
        state.lastRound = null;
      }
      state.draft = null;
      go('setup');
    },

    'pick-game': function (el) { startScene(el.getAttribute('data-game')); },
    'random-game': function () { startScene(pick(GAMES).id); },

    'reroll': function (el) {
      var key = el.getAttribute('data-key');
      var k = PROMPT_KEYS.filter(function (x) { return x.key === key; })[0];
      if (!k || !state.prompts) return;
      state.prompts[key] = pickDifferent(P[k.list], state.prompts[key]);
      popKey = key;
      save();
      render();
    },
    'reroll-extra': function (el) {
      var i = Number(el.getAttribute('data-index'));
      var x = state.extras[i];
      if (!x) return;
      var others = state.extras.filter(function (o, j) { return j !== i && o.list === x.list; }).map(function (o) { return o.value; });
      x.value = pickDifferent(P[x.list], x.value, others);
      popKey = 'extra-' + i;
      save();
      render();
    },
    'reveal': function (el) {
      var x = state.extras[Number(el.getAttribute('data-index'))];
      if (!x) return;
      x.revealed = !x.revealed;
      save();
      render();
    },

    'timer-start': startTimer,
    'timer-pause': pauseTimer,
    'timer-reset': resetTimer,
    'timer-plus': function () { adjustTimer(1); },
    'timer-minus': function () { adjustTimer(-1); },

    'scene-done': function () {
      stopTimerSilently();
      initVote();
      go('vote');
    },
    'back-to-picker': function () {
      stopTimerSilently();
      state.timer.remainingMs = timerLength() * 1000;
      go('picker');
    },
    'back-to-scene': function () {
      if (!state.prompts) { go('picker'); return; }
      go('scene');
    },

    'vote-mode': function (el) {
      var mode = el.getAttribute('data-mode') === 'quick' ? 'quick' : 'vote';
      if (state.vote.mode === mode) return;
      state.vote.mode = mode;
      save();
      render();
    },
    'vote-select': function (el) {
      var i = Number(el.getAttribute('data-player'));
      if (!(i >= 0 && i < state.players.length)) return;
      state.vote.selected = i;
      render();
    },
    'vote-submit': function () {
      var v = state.vote;
      var n = state.players.length;
      if (v.selected === null || v.voter >= n || v.votes.length !== v.voter) return;
      v.votes.push(v.selected);
      v.voter += 1;
      v.selected = null;
      if (v.voter >= n) {
        var pts = zeros(n);
        v.votes.forEach(function (t) { pts[t] += 1; });
        finishRound(pts);
      } else {
        save();
        render();
      }
    },
    'award-plus': function (el) {
      var i = Number(el.getAttribute('data-index'));
      if (!(i >= 0 && i < state.players.length)) return;
      state.vote.awards[i] = (state.vote.awards[i] || 0) + 1;
      save();
      render();
    },
    'award-minus': function (el) {
      var i = Number(el.getAttribute('data-index'));
      if (!(state.vote.awards[i] > 0)) return;
      state.vote.awards[i] -= 1;
      save();
      render();
    },
    'quick-done': function () { finishRound(state.vote.awards.slice()); },

    'next-round': function () {
      var n = state.players.length;
      state.starter = n ? (state.starter + 1) % n : 0;
      state.lastRound = null;
      initVote();
      go('picker');
    },
    'new-game': function () {
      state.players.forEach(function (p) { p.score = 0; });
      state.round = 0;
      state.starter = 0;
      state.lastRound = null;
      state.gameId = null;
      state.prompts = null;
      state.extras = [];
      initVote();
      go('picker');
    }
  };

  // ---------- Events ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) fn(el);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-testid') === 'player-name-input' && state.draft) {
      var i = Number(t.getAttribute('data-index'));
      if (state.draft[i]) state.draft[i].name = t.value;
    }
  });

  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-testid') === 'player-name-input') {
      // Select the default name so typing replaces it.
      if (/^Player \d$/.test(t.value)) setTimeout(function () { try { t.select(); } catch (err) { /* ignore */ } }, 0);
    }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === 'Enter' && t && t.getAttribute && t.getAttribute('data-testid') === 'player-name-input') {
      e.preventDefault();
      var inputs = Array.prototype.slice.call(document.querySelectorAll('[data-testid="player-name-input"]'));
      var idx = inputs.indexOf(t);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
      else t.blur();
    } else if (e.key === 'Escape') {
      hideFlash();
    }
  });

  document.addEventListener('toggle', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('rules')) {
      state.rulesOpen = e.target.open;
      save();
    }
  }, true);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      tick();
      if (state.timer.running) requestWakeLock();
    } else {
      save();
    }
  });

  window.addEventListener('pagehide', save);

  // ---------- Boot ----------
  load();
  if (!state.players.length) state.screen = 'setup';
  render();
})();
