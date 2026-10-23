// Cumulative match progress and meta.v1 backfill for clickomania-party.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var keys = Object.keys(api);
  for (var i = 0; i < keys.length; i++) root[keys[i]] = api[keys[i]];
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APP_VERSION = '1.0.2';
  var SLUG = 'clickomania-party';
  var SAVE_KEY = 'clickomania-party.save';

  // Declared stats. Counts, totals, and bests are monotonic.
  var STATS = [
    { key: 'games_played', monotonic: true },
    { key: 'rounds_played', monotonic: true },
    { key: 'turns_played', monotonic: true },
    { key: 'human_turns', monotonic: true },
    { key: 'ai_turns', monotonic: true },
    { key: 'groups_popped', monotonic: true },
    { key: 'cascade_groups', monotonic: true },
    { key: 'tiles_cleared', monotonic: true },
    { key: 'cascade_steps', monotonic: true },
    { key: 'best_cascade', monotonic: true },
    { key: 'board_clears', monotonic: true },
    { key: 'biggest_group', monotonic: true },
    { key: 'best_turn', monotonic: true },
    { key: 'best_score', monotonic: true },
    { key: 'total_score', monotonic: true },
    { key: 'human_wins', monotonic: true }
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

  var memory = null;

  function onPageHide() {
    flushMeta();
  }

  function onVisibilityChange() {
    try {
      var doc = typeof document !== 'undefined' ? document : globalThis.document;
      if (doc && doc.visibilityState === 'hidden') flushMeta();
    } catch (e) {}
  }

  function bindHideFlush() {
    try {
      var view = typeof window !== 'undefined' ? window : globalThis.window;
      if (view && view.addEventListener) {
        if (view.removeEventListener) view.removeEventListener('pagehide', onPageHide);
        view.addEventListener('pagehide', onPageHide);
      }
      var doc = typeof document !== 'undefined' ? document : globalThis.document;
      if (doc && doc.addEventListener) {
        if (doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibilityChange);
        doc.addEventListener('visibilitychange', onVisibilityChange);
      }
    } catch (e) {}
  }

  function isDemoMode() {
    try {
      var loc = typeof location !== 'undefined' ? location : globalThis.location;
      var search = loc && loc.search ? String(loc.search) : '';
      return /(?:^|[?&])(?:demo|preview)=(?:1|true|yes)(?:&|$)/.test(search);
    } catch (e) {
      return false;
    }
  }

  function emptyStats() {
    var stats = {};
    for (var i = 0; i < STATS.length; i++) stats[STATS[i].key] = 0;
    return stats;
  }

  function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function loadSave() {
    var save = emptyStats();
    try {
      var raw = globalThis.localStorage.getItem(SAVE_KEY);
      if (raw == null) return save;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return save;
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) save[keys[i]] = data[keys[i]];
      for (var s = 0; s < STATS.length; s++) {
        var statKey = STATS[s].key;
        if (typeof save[statKey] !== 'number' || !Number.isFinite(save[statKey])) save[statKey] = 0;
      }
      return save;
    } catch (e) {
      return emptyStats();
    }
  }

  function statsFromSave(save) {
    var stats = {};
    for (var i = 0; i < STATS.length; i++) {
      var key = STATS[i].key;
      var value = save ? save[key] : 0;
      stats[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    return stats;
  }

  function hydrate(stats) {
    memory = statsFromSave(stats);
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

  function isValidMeta(parsed, slug) {
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v === 1 && parsed.slug === slug;
  }

  function scheduleMeta() {
    try {
      if (isDemoMode() || !memory || typeof globalThis.metaUpdate !== 'function') return null;
      return globalThis.metaUpdate(SLUG, APP_VERSION, {
        stats: memory,
        logros: logrosFromStats(memory),
        declared: STATS
      });
    } catch (e) {
      return null;
    }
  }

  function metaBackfill(slug, version) {
    try {
      if (isDemoMode()) return null;
      var key = 'meta.v1.' + slug;
      var raw = globalThis.localStorage.getItem(key);
      if (raw != null) {
        var parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = null;
        }
        if (isValidMeta(parsed, slug)) {
          hydrate(parsed.stats);
          return parsed;
        }
        try {
          globalThis.localStorage.setItem(key + '.corrupt', raw);
        } catch (e) {}
      }
      var stats = statsFromSave(loadSave());
      hydrate(stats);
      if (typeof globalThis.metaUpdate !== 'function') return null;
      return globalThis.metaUpdate(slug, version, {
        stats: stats,
        logros: logrosFromStats(stats),
        declared: STATS
      });
    } catch (e) {
      return null;
    }
  }

  function recordTurn(turn) {
    try {
      if (isDemoMode()) return;
      if (!memory) hydrate(loadSave());
      turn = turn || {};
      memory.turns_played += 1;
      if (turn.human) memory.human_turns += 1;
      else memory.ai_turns += 1;
      memory.groups_popped += finite(turn.groups, 1);
      memory.cascade_groups += finite(turn.cascadeGroups, 0);
      memory.tiles_cleared += finite(turn.tiles, 0);
      memory.cascade_steps += finite(turn.cascadeSteps, 0);
      var cascade = finite(turn.cascade, 0);
      if (cascade > 1 && cascade > memory.best_cascade) memory.best_cascade = cascade;
      if (turn.boardClear) memory.board_clears += 1;
      var groupSize = finite(turn.groupSize, 0);
      if (groupSize > memory.biggest_group) memory.biggest_group = groupSize;
      var score = finite(turn.score, 0);
      if (score > memory.best_turn) memory.best_turn = score;
      scheduleMeta();
    } catch (e) {}
  }

  function recordRound() {
    try {
      if (isDemoMode()) return;
      if (!memory) hydrate(loadSave());
      memory.rounds_played += 1;
      scheduleMeta();
    } catch (e) {}
  }

  function recordGame(result) {
    try {
      if (isDemoMode()) return;
      if (!memory) hydrate(loadSave());
      result = result || {};
      memory.games_played += 1;
      memory.total_score += finite(result.total, 0);
      var best = finite(result.best, 0);
      if (best > memory.best_score) memory.best_score = best;
      if (result.humanWin) memory.human_wins += 1;
      scheduleMeta();
    } catch (e) {}
  }

  function flushMeta() {
    try {
      if (isDemoMode()) return null;
      if (typeof globalThis.metaFlush === 'function') return globalThis.metaFlush();
    } catch (e) {}
    return null;
  }

  function clearScheduledMeta() {
    memory = null;
    if (typeof globalThis.metaCancelPending === 'function') globalThis.metaCancelPending();
  }

  function bootProgress() {
    try {
      if (isDemoMode()) return;
      metaBackfill(SLUG, APP_VERSION);
      bindHideFlush();
    } catch (e) {}
  }

  return {
    APP_VERSION: APP_VERSION,
    SLUG: SLUG,
    SAVE_KEY: SAVE_KEY,
    STATS: STATS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    loadSave: loadSave,
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
