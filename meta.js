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

  var FASE = Object.freeze({ IDEA: 1, DEFINICION: 2, DISENO: 3, CONSTRUCCION: 4, VALIDACION: 5, LANZAMIENTO_Y_MANTENIMIENTO: 6, DESCARTADA: 7 });
  var ESTADO_FASE = Object.freeze({ PENDIENTE: 0, EN_CURSO: 1, BLOQUEADA: 2, EN_REVISION: 3, COMPLETADA: 4 });
  var TIPO_STAT = Object.freeze({ TOTAL_ACUMULADO: 'total_acumulado', MEJOR_MARCA: 'mejor_marca', VALOR_ACTUAL: 'valor_actual' });
  var TIPO_PROYECTO = Object.freeze({ PROYECTO: 'proyecto', AREA: 'area', RECURSO: 'recurso', ARCHIVO: 'archivo' });

  var PROYECTO = {
    objetivo: 'En algún momento pensé que era una buena idea, pero tal vez te sirva de inspiración.',
    fase: FASE.DESCARTADA,
    fase_estado: ESTADO_FASE.COMPLETADA,
    fases_completadas: 2,
    tipo: TIPO_PROYECTO.PROYECTO
  };

  var proyectoSource = PROYECTO;

  function proyectoInt(n, lo, hi) {
    return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
  }

  function enumValido(enumeracion, valor) {
    return Object.values(enumeracion).indexOf(valor) !== -1;
  }

  function statConservaMaximo(tipo) {
    return tipo === TIPO_STAT.TOTAL_ACUMULADO || tipo === TIPO_STAT.MEJOR_MARCA;
  }

  function statsDeclarados(stats) {
    if (Array.isArray(stats)) return stats;
    if (!stats || typeof stats !== 'object') return [];
    return Object.keys(stats).map(function (key) { return { key: key, tipo: stats[key] && stats[key].tipo }; });
  }

  function metaProyecto(p) {
    try {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
      var o = p.objetivo;
      if (typeof o !== 'string' || !o.trim() || Array.from(o).length > 140) return null;
      if (!enumValido(FASE, p.fase) || !enumValido(ESTADO_FASE, p.fase_estado) || !proyectoInt(p.fases_completadas, 0, FASE.LANZAMIENTO_Y_MANTENIMIENTO)) return null;
      if (p.tipo !== undefined && !enumValido(TIPO_PROYECTO, p.tipo)) return null;
      var bloque = { objetivo: o, fase: p.fase, fase_estado: p.fase_estado, fases_completadas: p.fases_completadas };
      if (p.tipo !== undefined) bloque.tipo = p.tipo;
      return bloque;
    } catch (e) {
      return null;
    }
  }

  function metaSetProyecto(p) {
    proyectoSource = p === null ? PROYECTO : p;
  }

  function withProyecto(record) {
    var p = metaProyecto(proyectoSource);
    if (p) record.proyecto = p;
    return record;
  }

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
    if (!declared || typeof declared !== 'object') return null;
    declared = statsDeclarados(declared);
    var list = [];
    for (var i = 0; i < declared.length && list.length < STAT_CAP; i++) {
      var item = declared[i];
      if (typeof item === 'string' && item) list.push({ key: item, tipo: TIPO_STAT.VALOR_ACTUAL });
      else if (item && typeof item.key === 'string' && item.key) list.push({ key: item.key, tipo: item.tipo });
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
          stats[key] = statConservaMaximo(spec.tipo) && isFiniteNumber(oldValue) ? Math.max(oldValue, nextStats[key]) : nextStats[key];
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
    var record = withProyecto(buildRecord(slug, version, prev, patch));
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
    metaCancelPending: metaCancelPending,
    metaProyecto: metaProyecto,
    metaSetProyecto: metaSetProyecto,
    PROYECTO: PROYECTO,
    FASE: FASE,
    ESTADO_FASE: ESTADO_FASE,
    TIPO_STAT: TIPO_STAT,
    TIPO_PROYECTO: TIPO_PROYECTO,
    enumValido: enumValido,
    statConservaMaximo: statConservaMaximo,
    statsDeclarados: statsDeclarados
  };
});
