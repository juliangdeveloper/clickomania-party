// Shared progress record meta.v1.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.metaUpdate = api.metaUpdate;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function metaKey(slug) {
    return 'meta.v1.' + slug;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function readRecord(key) {
    var store = globalThis.localStorage;
    if (!store) return null;
    var raw = store.getItem(key);
    if (raw == null) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  }

  function metaUpdate(slug, version, patch) {
    try {
      var key = metaKey(slug);
      var now = new Date().toISOString();
      var prev = null;
      try {
        prev = readRecord(key);
      } catch (e) {
        prev = null;
      }
      if (!prev) prev = {};
      patch = patch || {};

      var stats = {};
      var prevStats = prev.stats;
      if (prevStats && typeof prevStats === 'object' && !Array.isArray(prevStats)) {
        var prevKeys = Object.keys(prevStats);
        for (var i = 0; i < prevKeys.length; i++) {
          if (isFiniteNumber(prevStats[prevKeys[i]])) stats[prevKeys[i]] = prevStats[prevKeys[i]];
        }
      }
      var nextStats = patch.stats;
      if (nextStats && typeof nextStats === 'object' && !Array.isArray(nextStats)) {
        var nextKeys = Object.keys(nextStats);
        for (var j = 0; j < nextKeys.length; j++) {
          var statKey = nextKeys[j];
          if (isFiniteNumber(nextStats[statKey])) stats[statKey] = nextStats[statKey];
          else delete stats[statKey];
        }
      }

      var seen = Object.create(null);
      var logros = [];
      function addLogro(id) {
        if (typeof id !== 'string' || !id || seen[id]) return;
        seen[id] = true;
        logros.push(id);
      }
      var prevLogros = Array.isArray(prev.logros) ? prev.logros : [];
      for (var p = 0; p < prevLogros.length; p++) addLogro(prevLogros[p]);
      var incoming = Array.isArray(patch.logros) ? patch.logros : [];
      for (var n = 0; n < incoming.length; n++) addLogro(incoming[n]);
      logros.sort();

      var prevHitos = prev.hitos && typeof prev.hitos === 'object' && !Array.isArray(prev.hitos) ? prev.hitos : {};
      var hitos = {};
      for (var h = 0; h < logros.length; h++) {
        var id = logros[h];
        hitos[id] = typeof prevHitos[id] === 'string' ? prevHitos[id] : now;
      }

      var record = {
        v: 1,
        slug: slug,
        version: version,
        updatedAt: now,
        stats: stats,
        logros: logros,
        hitos: hitos
      };

      globalThis.localStorage.setItem(key, JSON.stringify(record));

      try {
        var view = typeof window !== 'undefined' ? window : globalThis.window;
        var here = typeof location !== 'undefined' ? location : globalThis.location;
        if (view && view.parent !== view) {
          view.parent.postMessage({ type: 'meta', key: key, data: record }, here.origin);
        }
      } catch (e) {}

      return record;
    } catch (e) {
      return null;
    }
  }

  return { metaUpdate: metaUpdate };
});
