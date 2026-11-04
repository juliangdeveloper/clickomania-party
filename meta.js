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
    tipo: TIPO_PROYECTO.PROYECTO,
    aportes: [
      { stat: 'Programación', exp: 6, fuente: 'creacion' },
      { stat: 'Diseño', exp: 6, fuente: 'creacion' },
      { stat: 'Planificación', exp: 20, fuente: 'uso' }
    ]
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

  var APORTE_STAT_MAX = 32;
  var APORTE_EXP_MAX = 99;

  function aportesValidos(lista) {
    if (!Array.isArray(lista)) return null;
    var out = [];
    var seen = {};
    for (var i = 0; i < lista.length; i++) {
      var it = lista[i];
      if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
      var stat = it.stat;
      var exp = it.exp;
      var fuente = it.fuente;
      if (typeof stat !== 'string' || !stat.trim() || stat !== stat.trim() || Array.from(stat).length > APORTE_STAT_MAX) return null;
      if (fuente !== 'creacion' && fuente !== 'uso') return null;
      if (!(proyectoInt(exp, 1, APORTE_EXP_MAX))) return null;
      var key = stat + '\n' + fuente;
      if (seen[key]) return null;
      if (Object.keys(it).length !== 3) return null;
      seen[key] = true;
      out.push({ stat: stat, exp: exp, fuente: fuente });
    }
    return out;
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
      if (p.bloqueada === true) bloque.bloqueada = true;
      if (p.aportes !== undefined) {
        var aportes = aportesValidos(p.aportes);
        if (!aportes) return null;
        bloque.aportes = aportes;
      }
      return bloque;
    } catch (e) {
      return null;
    }
  }

  function metaSetProyecto(p) {
    proyectoSource = p === null ? PROYECTO : p;
  }

  function metaDeclararProyecto(slug, version) {
    try {
      var store = globalThis.localStorage;
      if (!store || !slug) return null;
      var clave = 'meta.v1.' + slug;
      var raw = store.getItem(clave);
      var base = null;
      if (raw != null && raw !== '') {
        try {
          var previo = JSON.parse(raw);
          if (previo && typeof previo === 'object' && !Array.isArray(previo) && previo.v === 1 && previo.slug === slug) base = previo;
        } catch (e) {
          base = null;
        }
        if (!base) store.setItem(clave + '.corrupt', String(raw));
      }
      if (!base) base = { v: 1, slug: slug, version: String(version == null ? '' : version).replace(/^[vV]/, ''), updatedAt: new Date().toISOString(), stats: {}, logros: [], hitos: {} };
      var p = metaProyecto(proyectoSource);
      if (p) base.proyecto = p;
      var texto = JSON.stringify(base);
      if (texto !== raw) {
        store.setItem(clave, texto);
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) window.parent.postMessage({ type: 'meta', key: clave, data: base }, location.origin);
      }
      return base;
    } catch (e) {
      return null;
    }
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
      if (!pending) {
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
      if (!pending) return null;
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
    metaDeclararProyecto: metaDeclararProyecto,
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
