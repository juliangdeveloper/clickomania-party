const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const meta = require('../meta.js');
const progress = require('../progress.js');

const META_KEY = 'meta.v1.clickomania-party';

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    dump() {
      return data;
    }
  };
}

function install(initial) {
  progress.clearScheduledMeta();
  const store = memoryStorage(initial);
  globalThis.localStorage = store;
  globalThis.metaUpdate = meta.metaUpdate;
  return store;
}

const oldSave = {
  games_played: 2,
  rounds_played: 6,
  turns_played: 40,
  human_turns: 20,
  ai_turns: 20,
  groups_popped: 40,
  cascade_groups: 6,
  tiles_cleared: 300,
  cascade_steps: 4,
  best_cascade: 3,
  board_clears: 1,
  biggest_group: 9,
  best_turn: 120,
  best_score: 540,
  total_score: 800,
  human_wins: 1,
  legacy_flag: 1
};

test('old save without meta.v1 produces a record and keeps existing keys', () => {
  const store = install({
    [progress.SAVE_KEY]: JSON.stringify(oldSave),
    'unrelated.key': 'stay'
  });

  const record = progress.metaBackfill(progress.SLUG, progress.APP_VERSION);

  assert.equal(record.v, 1);
  assert.equal(record.slug, 'clickomania-party');
  assert.equal(record.version, progress.APP_VERSION);
  assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(record.stats, {
    games_played: 2,
    rounds_played: 6,
    turns_played: 40,
    human_turns: 20,
    ai_turns: 20,
    groups_popped: 40,
    cascade_groups: 6,
    tiles_cleared: 300,
    cascade_steps: 4,
    best_cascade: 3,
    board_clears: 1,
    biggest_group: 9,
    best_turn: 120,
    best_score: 540,
    total_score: 800,
    human_wins: 1
  });
  assert.deepEqual(record.logros, [
    'big_group',
    'board_clear',
    'cascade_x3',
    'first_cascade',
    'first_game',
    'human_win',
    'score_500',
    'turn_100'
  ]);
  assert.deepEqual(Object.keys(record.hitos).sort(), record.logros);
  for (const id of record.logros) {
    assert.equal(record.hitos[id], record.updatedAt);
  }
  assert.equal(store.getItem('unrelated.key'), 'stay');
  assert.equal(JSON.parse(store.getItem(progress.SAVE_KEY)).legacy_flag, 1);
  assert.equal(store.getItem(META_KEY) != null, true);
});

test('backfill does not overwrite an existing meta record', () => {
  const existing = {
    v: 1,
    slug: 'clickomania-party',
    version: '0.9.0',
    updatedAt: '2020-01-01T00:00:00.000Z',
    stats: { games_played: 1, best_score: 10 },
    logros: ['first_game'],
    hitos: { first_game: '2020-01-01T00:00:00.000Z' }
  };
  const raw = JSON.stringify(existing);
  const store = install({
    [META_KEY]: raw,
    [progress.SAVE_KEY]: JSON.stringify(Object.assign({}, oldSave, { games_played: 99, best_score: 9999 }))
  });

  const returned = progress.metaBackfill(progress.SLUG, progress.APP_VERSION);

  assert.equal(store.getItem(META_KEY), raw);
  assert.deepEqual(returned, existing);
  assert.equal(JSON.parse(store.getItem(progress.SAVE_KEY)).games_played, 99);
});

test('corrupt meta JSON does not crash and is left in place by backfill', () => {
  const store = install({
    [META_KEY]: '{not json',
    [progress.SAVE_KEY]: JSON.stringify(oldSave)
  });

  assert.doesNotThrow(() => progress.metaBackfill(progress.SLUG, progress.APP_VERSION));
  assert.equal(store.getItem(META_KEY), '{not json');

  let record;
  assert.doesNotThrow(() => {
    record = meta.metaUpdate(progress.SLUG, progress.APP_VERSION, {
      stats: { games_played: 1, best_score: NaN, label: 'no' },
      logros: ['first_game']
    });
  });
  assert.equal(record.v, 1);
  assert.equal(record.stats.games_played, 1);
  assert.equal(record.stats.best_score, undefined);
  assert.equal(record.stats.label, undefined);
  assert.deepEqual(record.logros, ['first_game']);
  assert.equal(typeof record.hitos.first_game, 'string');
});

test('metaUpdate merges stats, unions logros, and keeps the first hito', () => {
  install({});
  const OriginalDate = Date;
  function pinDate(iso) {
    function DateStub(...args) {
      if (args.length === 0) return new OriginalDate(iso);
      return new OriginalDate(...args);
    }
    DateStub.now = OriginalDate.now;
    DateStub.parse = OriginalDate.parse;
    DateStub.UTC = OriginalDate.UTC;
    globalThis.Date = DateStub;
  }
  try {
    pinDate('2020-01-01T00:00:00.000Z');
    const first = meta.metaUpdate('clickomania-party', '1.0.0', {
      stats: { games_played: 1, best_score: 20 },
      logros: ['first_game', 'first_game']
    });
    pinDate('2021-06-01T00:00:00.000Z');
    const second = meta.metaUpdate('clickomania-party', '1.0.0', {
      stats: { best_score: 80, tiles_cleared: Infinity },
      logros: ['score_500']
    });

    assert.equal(first.hitos.first_game, '2020-01-01T00:00:00.000Z');
    assert.equal(second.stats.games_played, 1);
    assert.equal(second.stats.best_score, 80);
    assert.equal(second.stats.tiles_cleared, undefined);
    assert.deepEqual(second.logros, ['first_game', 'score_500']);
    assert.equal(second.hitos.first_game, '2020-01-01T00:00:00.000Z');
    assert.equal(second.hitos.score_500, '2021-06-01T00:00:00.000Z');
    assert.equal(second.updatedAt, '2021-06-01T00:00:00.000Z');
    assert.equal(second.v, 1);
    assert.equal(second.slug, 'clickomania-party');
  } finally {
    globalThis.Date = OriginalDate;
  }
});

test('metaUpdate posts to the parent frame and never throws', () => {
  install({});
  const messages = [];
  const parent = {
    postMessage(data, origin) {
      messages.push({ data, origin });
    }
  };
  globalThis.window = { parent };
  globalThis.location = { origin: 'https://play.test' };

  const record = meta.metaUpdate('clickomania-party', '1.0.0', {
    stats: { games_played: 1 },
    logros: []
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].origin, 'https://play.test');
  assert.equal(messages[0].data.type, 'meta');
  assert.equal(messages[0].data.key, META_KEY);
  assert.equal(messages[0].data.data, record);

  globalThis.window = {};
  globalThis.window.parent = globalThis.window;
  assert.doesNotThrow(() => meta.metaUpdate('clickomania-party', '1.0.0', { stats: { games_played: 2 }, logros: [] }));
  assert.equal(messages.length, 1);

  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  assert.equal(meta.metaUpdate('clickomania-party', '1.0.0', { stats: { games_played: 1 }, logros: ['first_game'] }), null);

  delete globalThis.window;
  delete globalThis.location;
});

test('later saves keep unknown keys', () => {
  install({ [progress.SAVE_KEY]: JSON.stringify({ legacy_flag: 7, games_played: 1 }) });
  progress.recordTurn({ human: true, groups: 1, tiles: 3, cascadeSteps: 0, cascade: 1, groupSize: 3, score: 4 });
  const save = JSON.parse(globalThis.localStorage.getItem(progress.SAVE_KEY));
  assert.equal(save.legacy_flag, 7);
  assert.equal(save.games_played, 1);
  assert.equal(save.human_turns, 1);
  assert.equal(save.tiles_cleared, 3);
});

test('progress writes are debounced to one meta update', () => {
  const store = install({});
  let writes = 0;
  const orig = store.setItem.bind(store);
  store.setItem = (key, value) => {
    if (key === META_KEY) writes += 1;
    orig(key, value);
  };
  progress.recordGame({ best: 10, total: 15, humanWin: true });
  progress.recordRound();
  assert.equal(writes, 0);
  progress.flushMeta();
  assert.equal(writes, 1);
  const record = JSON.parse(store.getItem(META_KEY));
  assert.equal(record.stats.games_played, 1);
  assert.equal(record.stats.rounds_played, 1);
  assert.equal(record.stats.human_wins, 1);
  assert.deepEqual(record.logros, ['first_game', 'human_win']);
});

test('version strings in the page match APP_VERSION', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.version, progress.APP_VERSION);
  const queries = html.match(/\?v=([0-9.]+)/g);
  assert.ok(queries && queries.length >= 2);
  for (const query of queries) assert.equal(query, '?v=' + progress.APP_VERSION);
  assert.match(html, /recordTurn\(/);
  assert.match(html, /recordRound\(/);
  assert.match(html, /recordGame\(/);
  assert.match(html, /bootProgress\(/);
});
