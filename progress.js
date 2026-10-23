// Cumulative match progress and meta.v1 backfill for clickomania-party.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var keys = Object.keys(api);
  for (var i = 0; i < keys.length; i++) root[keys[i]] = api[keys[i]];
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var SLUG = 'clickomania-party';
  var SAVE_KEY = 'clickomania-party.save';

  var STAT_KEYS = [
    'games_played',
    'rounds_played',
    'turns_played',
    'human_turns',
    'ai_turns',
    'groups_popped',
    'cascade_groups',
    'tiles_cleared',
    'cascade_steps',
    'best_cascade',
    'board_clears',
    'biggest_group',
    'best_turn',
    'best_score',
    'total_score',
    'human_wins'
  ];

  // Stable ids. Conditions use save stats only.
  var ACHIEVEMENTS = [
    { id: 'first_game', met: function (s) { return s.games_played >= 1; } }, // finish one match
    { id: 'first_cascade', met: function (s) { return s.cascade_steps >= 1; } }, // one cascade step
    { id: 'cascade_x3', met: function (s) { return s.best_cascade >= 3; } }, // cascade multiplier reaches ×3
    { id: 'cascade_x5', met: function (s) { return s.best_cascade >= 5; } }, // cascade multiplier reaches ×5
    { id: 'board_clear', met: function (s) { return s.board_clears >= 1; } }, // clear the board once
    { id: 'big_group', met: function (s) { return s.biggest_group >= 8; } }, // remove a group of 8 or more
    { id: 'turn_100', met: function (s) { return s.best_turn >= 100; } }, // 100 or more points in one turn
    { id: 'score_500', met: function (s) { return s.best_score >= 500; } }, // 500 or more points in one match
    { id: 'score_1000', met: function (s) { return s.best_score >= 1000; } }, // 1000 or more points in one match
    { id: 'ten_games', met: function (s) { return s.games_played >= 10; } }, // finish ten matches
    { id: 'five_clears', met: function (s) { return s.board_clears >= 5; } }, // clear the board five times
    { id: 'human_win', met: function (s) { return s.human_wins >= 1; } } // a human seat finishes first
  ];

  var metaTimer = null;
  var metaLastWrite = 0;

  function emptySave() {
    var save = {};
    for (var i = 0; i < STAT_KEYS.length; i++) save[STAT_KEYS[i]] = 0;
    return save;
  }

  function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function loadSave() {
    var save = emptySave();
    try {
      var raw = globalThis.localStorage.getItem(SAVE_KEY);
      if (raw == null) return save;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return save;
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) save[keys[i]] = data[keys[i]];
      for (var s = 0; s < STAT_KEYS.length; s++) {
        var statKey = STAT_KEYS[s];
        if (typeof save[statKey] !== 'number' || !Number.isFinite(save[statKey])) save[statKey] = 0;
      }
      return save;
    } catch (e) {
      return emptySave();
    }
  }

  function persistSave(save) {
    try {
      var prev = {};
      try {
        var raw = globalThis.localStorage.getItem(SAVE_KEY);
        if (raw != null) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prev = parsed;
        }
      } catch (e) {
        prev = {};
      }
      var keys = Object.keys(save);
      for (var i = 0; i < keys.length; i++) prev[keys[i]] = save[keys[i]];
      globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(prev));
    } catch (e) {}
  }

  function statsFromSave(save) {
    var stats = {};
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var key = STAT_KEYS[i];
      var value = save ? save[key] : 0;
      stats[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    return stats;
  }

  function logrosFromStats(stats) {
    var ids = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      try {
        if (ACHIEVEMENTS[i].met(stats)) ids.push(ACHIEVEMENTS[i].id);
      } catch (e) {}
    }
    return ids;
  }

  function pushMeta() {
    try {
      if (typeof globalThis.metaUpdate !== 'function') return null;
      var save = loadSave();
      var stats = statsFromSave(save);
      return globalThis.metaUpdate(SLUG, APP_VERSION, { stats: stats, logros: logrosFromStats(stats) });
    } catch (e) {
      return null;
    }
  }

  function scheduleMeta() {
    try {
      if (metaTimer) return;
      var elapsed = Date.now() - metaLastWrite;
      var wait = elapsed >= 1000 ? 0 : 1000 - elapsed;
      metaTimer = setTimeout(function () {
        metaTimer = null;
        metaLastWrite = Date.now();
        pushMeta();
      }, wait);
    } catch (e) {}
  }

  function flushMeta() {
    try {
      if (!metaTimer) return;
      clearTimeout(metaTimer);
      metaTimer = null;
      metaLastWrite = Date.now();
      pushMeta();
    } catch (e) {}
  }

  function clearScheduledMeta() {
    if (!metaTimer) return;
    clearTimeout(metaTimer);
    metaTimer = null;
  }

  function metaBackfill(slug, version) {
    try {
      var key = 'meta.v1.' + slug;
      var raw = globalThis.localStorage.getItem(key);
      if (raw != null) {
        JSON.parse(raw);
        return JSON.parse(raw);
      }
      var save = loadSave();
      var stats = statsFromSave(save);
      return globalThis.metaUpdate(slug, version, { stats: stats, logros: logrosFromStats(stats) });
    } catch (e) {
      return null;
    }
  }

  function recordTurn(turn) {
    try {
      var save = loadSave();
      turn = turn || {};
      save.turns_played += 1;
      if (turn.human) save.human_turns += 1;
      else save.ai_turns += 1;
      save.groups_popped += finite(turn.groups, 1);
      save.cascade_groups += finite(turn.cascadeGroups, 0);
      save.tiles_cleared += finite(turn.tiles, 0);
      save.cascade_steps += finite(turn.cascadeSteps, 0);
      var cascade = finite(turn.cascade, 0);
      if (cascade > 1 && cascade > save.best_cascade) save.best_cascade = cascade;
      if (turn.boardClear) save.board_clears += 1;
      var groupSize = finite(turn.groupSize, 0);
      if (groupSize > save.biggest_group) save.biggest_group = groupSize;
      var score = finite(turn.score, 0);
      if (score > save.best_turn) save.best_turn = score;
      persistSave(save);
      scheduleMeta();
    } catch (e) {}
  }

  function recordRound() {
    try {
      var save = loadSave();
      save.rounds_played += 1;
      persistSave(save);
      scheduleMeta();
    } catch (e) {}
  }

  function recordGame(result) {
    try {
      var save = loadSave();
      result = result || {};
      save.games_played += 1;
      save.total_score += finite(result.total, 0);
      var best = finite(result.best, 0);
      if (best > save.best_score) save.best_score = best;
      if (result.humanWin) save.human_wins += 1;
      persistSave(save);
      scheduleMeta();
    } catch (e) {}
  }

  function bootProgress() {
    try {
      metaBackfill(SLUG, APP_VERSION);
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', flushMeta);
      }
    } catch (e) {}
  }

  return {
    APP_VERSION: APP_VERSION,
    SLUG: SLUG,
    SAVE_KEY: SAVE_KEY,
    STAT_KEYS: STAT_KEYS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    loadSave: loadSave,
    persistSave: persistSave,
    statsFromSave: statsFromSave,
    logrosFromStats: logrosFromStats,
    metaBackfill: metaBackfill,
    recordTurn: recordTurn,
    recordRound: recordRound,
    recordGame: recordGame,
    scheduleMeta: scheduleMeta,
    flushMeta: flushMeta,
    clearScheduledMeta: clearScheduledMeta,
    bootProgress: bootProgress
  };
});
