const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const meta = require('../meta.js');
const progress = require('../progress.js');

const META_KEY = 'meta.v1.clickomania-party';
const CORRUPT_KEY = META_KEY + '.corrupt';

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
  globalThis.metaUpdate = meta.metaUpdate;
  globalThis.metaFlush = meta.metaFlush;
  globalThis.metaCancelPending = meta.metaCancelPending;
  meta.metaCancelPending();
  progress.clearScheduledMeta();
  const store = memoryStorage(initial);
  globalThis.localStorage = store;
  return store;
}

function metaWrites(store) {
  let writes = 0;
  const orig = store.setItem.bind(store);
  store.setItem = (key, value) => {
    if (key === META_KEY) writes += 1;
    orig(key, value);
  };
  return () => writes;
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
  const rawSave = JSON.stringify(oldSave);
  const store = install({
    [progress.SAVE_KEY]: rawSave,
    'unrelated.key': 'stay'
  });

  const record = progress.metaBackfill(progress.SLUG, progress.APP_VERSION);

  assert.equal(record.v, 1);
  assert.equal(record.slug, 'clickomania-party');
  assert.equal(record.version, progress.APP_VERSION);
  assert.equal(/^v/i.test(record.version), false);
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
  assert.equal(Object.keys(record.stats).length <= 20, true);
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
  for (const id of record.logros) assert.equal(record.hitos[id], record.updatedAt);
  assert.equal(store.getItem('unrelated.key'), 'stay');
  assert.equal(store.getItem(progress.SAVE_KEY), rawSave);
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
  const rawSave = JSON.stringify(Object.assign({}, oldSave, { games_played: 99, best_score: 9999 }));
  const store = install({
    [META_KEY]: raw,
    [progress.SAVE_KEY]: rawSave
  });

  const returned = progress.metaBackfill(progress.SLUG, progress.APP_VERSION);

  assert.equal(store.getItem(META_KEY), raw);
  assert.equal(store.getItem(CORRUPT_KEY), null);
  assert.equal(store.getItem(progress.SAVE_KEY), rawSave);
  assert.deepEqual(returned, existing);
});

test('corrupt records are copied and rebuilt from the save', () => {
  const cases = [
    '{not json',
    JSON.stringify([1, 2, 3]),
    JSON.stringify({ v: 2, slug: 'clickomania-party', stats: { games_played: 99 } }),
    JSON.stringify({ v: '1', slug: 'clickomania-party' }),
    JSON.stringify({ v: 1, slug: 'other-app', stats: { games_played: 99 } }),
    'null'
  ];
  const rawSave = JSON.stringify(oldSave);
  for (const corrupt of cases) {
    const store = install({
      [META_KEY]: corrupt,
      [progress.SAVE_KEY]: rawSave,
      'unrelated.key': 'stay'
    });
    let record;
    assert.doesNotThrow(() => {
      record = progress.metaBackfill(progress.SLUG, progress.APP_VERSION);
    });
    assert.equal(store.getItem(CORRUPT_KEY), corrupt);
    assert.equal(store.getItem(progress.SAVE_KEY), rawSave);
    assert.equal(store.getItem('unrelated.key'), 'stay');
    assert.equal(record.v, 1);
    assert.equal(record.slug, 'clickomania-party');
    assert.equal(record.stats.games_played, 2);
    assert.equal(record.stats.best_score, 540);
    assert.equal(record.logros.includes('first_game'), true);
    assert.equal(record.logros.includes('ten_games'), false);
  }
});

test('helper keeps at most 20 declared stats and drops undeclared keys', () => {
  install({});
  const declared = [];
  const stats = { extra_stat: 99, also_extra: 1 };
  for (let i = 0; i < 21; i++) {
    const key = 'stat_' + String(i).padStart(2, '0');
    declared.push({ key: key, monotonic: false });
    stats[key] = i + 1;
  }
  const record = meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
    stats: stats,
    logros: [],
    declared: declared
  });
  assert.deepEqual(Object.keys(record.stats), declared.slice(0, 20).map((item) => item.key));
  assert.equal(record.stats.stat_20, undefined);
  assert.equal(record.stats.extra_stat, undefined);
  assert.equal(record.stats.also_extra, undefined);
  assert.equal(record.stats.stat_00, 1);
  assert.equal(record.stats.stat_19, 20);
});

test('monotonic stats never decrease and omitted keys stay', () => {
  install({});
  const declared = [
    { key: 'games_played', monotonic: true },
    { key: 'level', monotonic: false }
  ];
  const OriginalDate = Date;
  let now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  function pinDate(iso) {
    function DateStub(...args) {
      if (args.length === 0) return new OriginalDate(iso);
      return new OriginalDate(...args);
    }
    DateStub.now = () => now;
    DateStub.parse = OriginalDate.parse;
    DateStub.UTC = OriginalDate.UTC;
    globalThis.Date = DateStub;
  }
  try {
    pinDate('2020-01-01T00:00:00.000Z');
    const first = meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: 5, level: 3, extra_stat: 8 },
      logros: ['first_game', 'first_game'],
      declared: declared
    });
    now += 1000;
    pinDate('2021-06-01T00:00:00.000Z');
    const second = meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: 2, level: 1 },
      logros: ['score_500'],
      declared: declared
    });
    now += 1000;
    pinDate('2022-01-01T00:00:00.000Z');
    const third = meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: NaN },
      logros: [],
      declared: declared
    });

    assert.equal(first.stats.extra_stat, undefined);
    assert.deepEqual(Object.keys(first.stats), ['games_played', 'level']);
    assert.equal(second.stats.games_played, 5);
    assert.equal(second.stats.level, 1);
    assert.equal(third.stats.games_played, 5);
    assert.equal(third.stats.level, 1);
    assert.deepEqual(second.logros, ['first_game', 'score_500']);
    assert.equal(second.hitos.first_game, '2020-01-01T00:00:00.000Z');
    assert.equal(second.hitos.score_500, '2021-06-01T00:00:00.000Z');
    assert.equal(first.hitos.first_game, '2020-01-01T00:00:00.000Z');
  } finally {
    globalThis.Date = OriginalDate;
    Date.now = originalNow;
    meta.metaCancelPending();
  }
});

test('meta writes at most once per second, including backfill and flush', () => {
  const rawSave = JSON.stringify(oldSave);
  const store = install({
    [progress.SAVE_KEY]: rawSave,
    'unrelated.key': 'stay'
  });
  const writes = metaWrites(store);
  let now = 50_000;
  const originalNow = Date.now;
  Date.now = () => now;
  const messages = [];
  globalThis.window = { parent: { postMessage(data, origin) { messages.push({ data, origin }); } } };
  globalThis.location = { origin: 'https://play.test', search: '' };
  try {
    progress.bootProgress();
    assert.equal(writes(), 1);
    assert.equal(messages.length, 1);
    progress.recordTurn({
      human: true,
      groups: 1,
      tiles: 4,
      cascadeSteps: 1,
      cascade: 2,
      groupSize: 4,
      score: 9
    });
    progress.recordGame({ best: 600, total: 600, humanWin: true });
    assert.equal(progress.flushMeta(), null);
    assert.equal(writes(), 1);
    assert.equal(JSON.parse(store.getItem(META_KEY)).stats.turns_played, 40);
    now += 999;
    assert.equal(progress.flushMeta(), null);
    assert.equal(writes(), 1);
    now += 1;
    const flushed = progress.flushMeta();
    assert.equal(writes(), 2);
    assert.equal(messages.length, 2);
    assert.equal(flushed.stats.turns_played, 41);
    assert.equal(flushed.stats.games_played, 3);
    assert.equal(flushed.stats.human_wins, 2);
    assert.equal(flushed.logros.includes('score_500'), true);
    assert.equal(store.getItem(progress.SAVE_KEY), rawSave);
    assert.equal(store.getItem('unrelated.key'), 'stay');
    assert.equal(messages[1].data.type, 'meta');
    assert.equal(messages[1].data.key, META_KEY);
    assert.equal(messages[1].origin, 'https://play.test');
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
    delete globalThis.location;
    meta.metaCancelPending();
    progress.clearScheduledMeta();
  }
});

test('demo and preview modes do not write or postMessage', () => {
  for (const search of ['?demo=1', '?preview=1', '?x=1&demo=true']) {
    const store = install({ [progress.SAVE_KEY]: JSON.stringify(oldSave) });
    const writes = metaWrites(store);
    const messages = [];
    globalThis.window = { parent: { postMessage(data, origin) { messages.push({ data, origin }); } } };
    globalThis.location = { origin: 'https://play.test', search: search };
    try {
      progress.bootProgress();
      progress.recordTurn({ human: true, groups: 1, tiles: 3, cascade: 1, groupSize: 3, score: 1 });
      progress.recordGame({ best: 10, total: 10, humanWin: true });
      progress.flushMeta();
      meta.metaUpdate(progress.SLUG, progress.APP_VERSION, {
        stats: { games_played: 4 },
        logros: ['first_game'],
        declared: progress.STATS
      });
      assert.equal(writes(), 0);
      assert.equal(messages.length, 0);
      assert.equal(store.getItem(META_KEY), null);
      assert.equal(store.getItem(progress.SAVE_KEY), JSON.stringify(oldSave));
    } finally {
      delete globalThis.window;
      delete globalThis.location;
      meta.metaCancelPending();
      progress.clearScheduledMeta();
    }
  }
});

test('load and play leave old save keys byte-identical', () => {
  const blob = 'data:image/png;base64,' + 'A'.repeat(4000);
  const save = Object.assign({}, oldSave, { portrait: blob });
  const rawSave = JSON.stringify(save);
  const store = install({
    [progress.SAVE_KEY]: rawSave,
    'settings.v1': '{"sound":true}',
    'unrelated.key': 'stay'
  });
  let now = 80_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    progress.bootProgress();
    progress.recordTurn({
      human: false,
      groups: 1,
      tiles: 8,
      cascadeGroups: 2,
      cascadeSteps: 1,
      cascade: 2,
      boardClear: true,
      groupSize: 8,
      score: 30
    });
    progress.recordRound();
    now += 1000;
    progress.flushMeta();
    assert.equal(store.getItem(progress.SAVE_KEY), rawSave);
    assert.equal(store.getItem('settings.v1'), '{"sound":true}');
    assert.equal(store.getItem('unrelated.key'), 'stay');
    const record = JSON.parse(store.getItem(META_KEY));
    assert.equal(record.stats.turns_played, 41);
    assert.equal(record.stats.ai_turns, 21);
    assert.equal(record.stats.board_clears, 2);
    assert.equal(record.stats.rounds_played, 7);
    assert.equal(record.stats.portrait, undefined);
  } finally {
    Date.now = originalNow;
    meta.metaCancelPending();
    progress.clearScheduledMeta();
  }
});

test('metaUpdate posts to the parent frame and never throws', () => {
  install({});
  const messages = [];
  globalThis.window = {
    parent: {
      postMessage(data, origin) {
        messages.push({ data, origin });
      }
    }
  };
  globalThis.location = { origin: 'https://play.test', search: '' };
  try {
    const record = meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: 1 },
      logros: [],
      declared: progress.STATS
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, 'https://play.test');
    assert.equal(messages[0].data.type, 'meta');
    assert.equal(messages[0].data.key, META_KEY);
    assert.equal(messages[0].data.data, record);

    globalThis.window = {};
    globalThis.window.parent = globalThis.window;
    meta.metaCancelPending();
    assert.doesNotThrow(() => meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: 2 },
      logros: [],
      declared: progress.STATS
    }));
    assert.equal(messages.length, 1);

    meta.metaCancelPending();
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); }
    };
    assert.equal(meta.metaUpdate('clickomania-party', progress.APP_VERSION, {
      stats: { games_played: 1 },
      logros: ['first_game'],
      declared: progress.STATS
    }), null);
  } finally {
    delete globalThis.window;
    delete globalThis.location;
    meta.metaCancelPending();
  }
});

test('version strings in the page match APP_VERSION', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(progress.APP_VERSION, '1.0.1');
  assert.equal(/^v/i.test(progress.APP_VERSION), false);
  assert.equal(pkg.version, progress.APP_VERSION);
  const queries = html.match(/\?v=([0-9.]+)/g);
  assert.ok(queries && queries.length >= 2);
  for (const query of queries) assert.equal(query, '?v=' + progress.APP_VERSION);
  assert.equal(html.includes('1.0.0'), false);
  assert.match(html, /recordTurn\(/);
  assert.match(html, /recordRound\(/);
  assert.match(html, /recordGame\(/);
  assert.match(html, /bootProgress\(/);
  assert.equal(progress.STATS.length <= 20, true);
});
