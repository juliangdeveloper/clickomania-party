// Shared progress record meta.v1.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var names = Object.keys(api);
  for (var i = 0; i < names.length; i++) root[names[i]] = api[names[i]];
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var lastWriteAt = 0;
  var pending = null;
  var timer = null;
  var STAT_CAP = 20;

  function metaKey(slug) {
    return 'meta.v1.' + slug;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
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

  function isValidRecord(parsed, slug) {
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v === 1 && parsed.slug === slug;
  }

  function declaredList(declared) {
    if (!Array.isArray(declared)) return null;
    var list = [];
    for (var i = 0; i < declared.length && list.length < STAT_CAP; i++) {
      var item = declared[i];
      if (typeof item === 'string' && item) list.push({ key: item, monotonic: false });
      else if (item && typeof item.key === 'string' && item.key) list.push({ key: item.key, monotonic: !!item.monotonic });
    }
    return list;
  }

  function mergeStats(prev, patch) {
    var prevStats = prev && prev.stats && typeof prev.stats === 'object' && !Array.isArray(prev.stats) ? prev.stats : {};
    var nextStats = patch && patch.stats && typeof patch.stats === 'object' && !Array.isArray(patch.stats) ? patch.stats : null;
    var declared = declaredList(patch && patch.declared);
    var stats = {};
    if (declared) {
      for (var i = 0; i < declared.length; i++) {
        var spec = declared[i];
        var key = spec.key;
        var oldValue = prevStats[key];
        var hasNew = !!(nextStats && Object.prototype.hasOwnProperty.call(nextStats, key));
        if (hasNew && isFiniteNumber(nextStats[key])) {
          stats[key] = spec.monotonic && isFiniteNumber(oldValue) ? Math.max(oldValue, nextStats[key]) : nextStats[key];
        } else if (isFiniteNumber(oldValue)) {
          stats[key] = oldValue;
        }
      }
      return stats;
    }
    var names = Object.keys(prevStats);
    if (nextStats) {
      var incoming = Object.keys(nextStats);
      for (var n = 0; n < incoming.length; n++) {
        if (names.indexOf(incoming[n]) === -1) names.push(incoming[n]);
      }
    }
    for (var k = 0; k < names.length && Object.keys(stats).length < STAT_CAP; k++) {
      var name = names[k];
      var has = !!(nextStats && Object.prototype.hasOwnProperty.call(nextStats, name));
      if (has && isFiniteNumber(nextStats[name])) stats[name] = nextStats[name];
      else if (isFiniteNumber(prevStats[name])) stats[name] = prevStats[name];
    }
    return stats;
  }

  function buildRecord(slug, version, prev, patch) {
    var now = new Date().toISOString();
    var seen = Object.create(null);
    var logros = [];
    function addLogro(id) {
      if (typeof id !== 'string' || !id || seen[id]) return;
      seen[id] = true;
      logros.push(id);
    }
    var prevLogros = prev && Array.isArray(prev.logros) ? prev.logros : [];
    for (var p = 0; p < prevLogros.length; p++) addLogro(prevLogros[p]);
    var incoming = patch && Array.isArray(patch.logros) ? patch.logros : [];
    for (var n = 0; n < incoming.length; n++) addLogro(incoming[n]);
    logros.sort();
    var prevHitos = prev && prev.hitos && typeof prev.hitos === 'object' && !Array.isArray(prev.hitos) ? prev.hitos : {};
    var hitos = {};
    for (var h = 0; h < logros.length; h++) {
      var id = logros[h];
      hitos[id] = typeof prevHitos[id] === 'string' ? prevHitos[id] : now;
    }
    return {
      v: 1,
      slug: slug,
      version: version,
      updatedAt: now,
      stats: mergeStats(prev, patch),
      logros: logros,
      hitos: hitos
    };
  }

  function stashCorrupt(key, raw) {
    try {
      if (raw != null) globalThis.localStorage.setItem(key + '.corrupt', raw);
    } catch (e) {}
  }

  function readPrevious(key, slug) {
    var raw = null;
    try {
      raw = globalThis.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
    if (raw == null) return null;
    try {
      var parsed = JSON.parse(raw);
      if (isValidRecord(parsed, slug)) return parsed;
    } catch (e) {}
    stashCorrupt(key, raw);
    return null;
  }

  function postRecord(key, record) {
    try {
      var view = typeof window !== 'undefined' ? window : globalThis.window;
      var here = typeof location !== 'undefined' ? location : globalThis.location;
      if (view && view.parent !== view && here) {
        view.parent.postMessage({ type: 'meta', key: key, data: record }, here.origin);
      }
    } catch (e) {}
  }

  function commit(slug, version, patch) {
    var key = metaKey(slug);
    var prev = readPrevious(key, slug);
    var record = buildRecord(slug, version, prev, patch);
    globalThis.localStorage.setItem(key, JSON.stringify(record));
    lastWriteAt = Date.now();
    postRecord(key, record);
    return record;
  }

  function arm(wait) {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (!pending || isDemoMode()) {
        pending = null;
        return;
      }
      var elapsed = Date.now() - lastWriteAt;
      if (lastWriteAt && elapsed < 1000) {
        arm(1000 - elapsed);
        return;
      }
      var job = pending;
      pending = null;
      try {
        commit(job.slug, job.version, job.patch);
      } catch (e) {}
    }, wait);
  }

  function metaUpdate(slug, version, patch) {
    try {
      if (isDemoMode()) return null;
      patch = patch || {};
      var nowMs = Date.now();
      if (lastWriteAt && nowMs - lastWriteAt < 1000) {
        pending = { slug: slug, version: version, patch: patch };
        arm(1000 - (nowMs - lastWriteAt));
        return null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      return commit(slug, version, patch);
    } catch (e) {
      return null;
    }
  }

  function metaFlush() {
    try {
      if (!pending || isDemoMode()) return null;
      if (lastWriteAt && Date.now() - lastWriteAt < 1000) return null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      var job = pending;
      pending = null;
      return commit(job.slug, job.version, job.patch);
    } catch (e) {
      return null;
    }
  }

  function metaCancelPending() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
    lastWriteAt = 0;
  }

  return {
    metaUpdate: metaUpdate,
    metaFlush: metaFlush,
    metaCancelPending: metaCancelPending
  };
});
