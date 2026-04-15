/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — freshness.js v1.0
   ─────────────────────────────────────────────────────────────────
   Módulo de frescura de datos e integraciones.
   Todos los dashboards importan este módulo para mostrar:
   - Badge de frescura de datos
   - Advertencia de datos desactualizados
   - Estado de integraciones
   - Fallback manual

   CONTRATO PÚBLICO:
   KausayFreshness.renderBadge(containerId)   → pinta badge en el toolbar
   KausayFreshness.renderBanner(containerId)  → banner de advertencia si datos viejos
   KausayFreshness.getStatus()                → { nivel, score, integraciones }
   KausayFreshness.recordManualSync(sistema, datos) → registra carga manual
   ═══════════════════════════════════════════════════════════════════ */

const KausayFreshness = (() => {

  /* ─── Umbrales de frescura ──────────────────────────────────── */
  const UMBRALES = {
    fresco:        { score: 80, label: 'Datos al día',    color: '#1A7A45', bg: 'rgba(26,122,69,.12)',  brd: 'rgba(26,122,69,.25)'  },
    reciente:      { score: 50, label: 'Datos recientes', color: '#C8880A', bg: 'rgba(200,136,10,.12)', brd: 'rgba(200,136,10,.25)' },
    desactualizado:{ score: 20, label: 'Datos viejos',    color: '#B02020', bg: 'rgba(176,32,32,.12)',  brd: 'rgba(176,32,32,.25)'  },
    sin_datos:     { score:  0, label: 'Sin conexión',    color: '#6A6A7A', bg: 'rgba(106,106,122,.1)', brd: 'rgba(106,106,122,.2)' },
  };

  /* ─── Calcular nivel según score ────────────────────────────── */
  function _nivel(score) {
    if (score >= UMBRALES.fresco.score)        return 'fresco';
    if (score >= UMBRALES.reciente.score)      return 'reciente';
    if (score >= UMBRALES.desactualizado.score) return 'desactualizado';
    return 'sin_datos';
  }

  /* ─── Calcular score global desde integraciones ─────────────── */
  function _globalScore(integraciones) {
    if (!integraciones?.length) return 0;
    // Promedio ponderado: SIAF_GL pesa el doble (fuente de presupuesto)
    const weights = { SIAF_GL: 2, INVIERTE_PE: 1.5, SEACE: 1 };
    let total = 0, weight = 0;
    integraciones.forEach(i => {
      const w = weights[i.sistema] || 1;
      total  += (i.freshness || 0) * w;
      weight += w;
    });
    return Math.round(total / (weight || 1));
  }

  /* ─── Formatear tiempo de última sync ──────────────────────── */
  function _fmtSync(ts) {
    if (!ts) return '—';
    const d = Date.now() - ts;
    if (d < 60_000)          return 'Hace un momento';
    if (d < 3_600_000)       return `Hace ${Math.floor(d/60_000)} min`;
    if (d < 86_400_000)      return `Hace ${Math.floor(d/3_600_000)}h`;
    if (d < 604_800_000)     return `Hace ${Math.floor(d/86_400_000)}d`;
    return new Date(ts).toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
  }

  /* ─── Estado público ────────────────────────────────────────── */
  function getStatus() {
    const integ  = typeof KausayDB !== 'undefined' ? KausayDB.getIntegraciones() : [];
    const score  = _globalScore(integ);
    const niv    = _nivel(score);
    const caidas = integ.filter(i => i.estado === 'desconectado').length;
    const degradas= integ.filter(i => i.estado === 'degradado').length;
    const ultimaSync = integ.reduce((max, i) => Math.max(max, i.ultima_sync || 0), 0);
    return { nivel: niv, score, integraciones: integ,
             caidas, degradas, ultima_sync: ultimaSync,
             config: UMBRALES[niv] };
  }

  /* ─── Badge de frescura (inline en toolbar) ─────────────────── */
  function renderBadge(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const st  = getStatus();
    const cfg = st.config;
    const old = document.getElementById('kk-fresh-badge');
    if (old) old.remove();

    const badge = document.createElement('div');
    badge.id = 'kk-fresh-badge';
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      background:${cfg.bg};border:1px solid ${cfg.brd};
      border-radius:9px;padding:3px 9px;cursor:pointer;
      font-family:var(--f-sans,'system-ui');font-size:10px;font-weight:600;
      color:${cfg.color};white-space:nowrap;transition:opacity .15s;
    `;
    badge.innerHTML = `
      <span style="width:6px;height:6px;border-radius:50%;background:${cfg.color};flex-shrink:0;${st.nivel!=='fresco'?'animation:pulse 2s infinite':''}"></span>
      ${cfg.label} · ${_fmtSync(st.ultima_sync)}
      ${st.caidas > 0 ? `<span style="background:rgba(176,32,32,.3);border-radius:5px;padding:0 4px">${st.caidas}⬇</span>` : ''}
    `;
    badge.title = _buildTooltip(st);
    badge.onclick = () => _showFreshnessPanel(st);
    container.appendChild(badge);

    // Actualizar cada 2 minutos
    setTimeout(() => renderBadge(containerId), 120_000);
  }

  /* ─── Banner de advertencia (si datos viejos) ───────────────── */
  function renderBanner(containerId) {
    const container = document.getElementById(containerId);
    const st = getStatus();
    if (!container || st.nivel === 'fresco') return;

    const old = document.getElementById('kk-fresh-banner');
    if (old) old.remove();

    if (st.nivel === 'sin_datos' || st.caidas > 0) {
      const banner = document.createElement('div');
      banner.id = 'kk-fresh-banner';
      const cfg = st.config;
      banner.style.cssText = `
        background:${cfg.bg};border:1px solid ${cfg.brd};
        border-radius:var(--r-md,10px);padding:9px 14px;
        display:flex;align-items:center;gap:10px;
        font-family:var(--f-sans,'system-ui');font-size:11px;
        color:${cfg.color};font-weight:500;line-height:1.5;
        margin-bottom:6px;
      `;
      const msgs = {
        desactualizado: `⏱ Algunos datos pueden tener más de 6 horas. ${st.caidas>0?`${st.caidas} integración${st.caidas>1?'es caídas':' caída'}.`:''} Verifica antes de tomar decisiones.`,
        sin_datos: `📡 Sin datos externos actualizados. El sistema muestra datos del última carga manual. ${st.caidas>0?`${st.caidas} sistema${st.caidas>1?'s':''}  sin conexión.`:''}`,
        reciente: `ℹ Datos actualizados hace más de 2 horas. Considera actualizar antes de la reunión.`,
      };
      banner.innerHTML = `
        <span style="font-size:16px;flex-shrink:0">${st.nivel==='sin_datos'?'📡':'⏱'}</span>
        <span style="flex:1">${msgs[st.nivel]||''}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:${cfg.color};cursor:pointer;font-size:14px;padding:0 4px;opacity:.6">✕</button>
      `;
      container.insertBefore(banner, container.firstChild);
    }
  }

  /* ─── Panel detallado de integraciones ─────────────────────── */
  function _showFreshnessPanel(st) {
    const old = document.getElementById('kk-fresh-panel');
    if (old) { old.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'kk-fresh-panel';
    panel.style.cssText = `
      position:fixed;top:60px;right:16px;z-index:150;width:280px;
      background:var(--c-card,#fff);border:1px solid var(--c-borde,#eee);
      border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.15);
      padding:14px;font-family:var(--f-sans,'system-ui');
    `;

    const SISTEMA_LABELS = {
      SIAF_GL:     { label:'SIAF GL',     desc:'Presupuesto y devengado MEF', ico:'💰' },
      INVIERTE_PE: { label:'Invierte.pe', desc:'Seguimiento de obras',        ico:'🏗' },
      SEACE:       { label:'SEACE',       desc:'Procesos de contratación',     ico:'📋' },
    };

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-weight:700;font-size:13px;color:var(--c-negro,#111)">Estado de fuentes de datos</div>
        <button onclick="document.getElementById('kk-fresh-panel').remove()" style="background:none;border:none;cursor:pointer;color:var(--c-gris3,#888);font-size:16px">✕</button>
      </div>
      ${st.integraciones.map(i => {
        const meta = SISTEMA_LABELS[i.sistema] || { label:i.sistema, desc:'Sistema externo', ico:'🔗' };
        const col  = i.estado==='activo'?'#1A7A45':i.estado==='degradado'?'#C8880A':'#B02020';
        const dot  = i.estado==='activo'?'✅':i.estado==='degradado'?'⚠️':'🔴';
        return `
          <div style="background:var(--c-bg,#f8f8f8);border-radius:9px;padding:9px 11px;margin-bottom:7px">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
              <span>${meta.ico}</span>
              <span style="font-size:12px;font-weight:600;color:var(--c-negro,#111);flex:1">${meta.label}</span>
              <span style="font-size:11px">${dot}</span>
              <span style="font-size:10px;font-weight:700;color:${col}">${i.estado}</span>
            </div>
            <div style="font-size:10px;color:var(--c-gris3,#888)">${meta.desc}</div>
            <div style="display:flex;gap:8px;margin-top:5px;font-size:10px;color:var(--c-gris3,#888)">
              <span>🕐 ${_fmtSync(i.ultima_sync)}</span>
              <span>Frescura: <strong style="color:${col}">${i.freshness}%</strong></span>
            </div>
            ${i.error ? `<div style="font-size:10px;color:#B02020;margin-top:3px">⚠ ${i.error}</div>` : ''}
          </div>`;
      }).join('')}
      <div style="border-top:1px solid var(--c-borde,#eee);padding-top:10px;margin-top:4px">
        <div style="font-size:10px;color:var(--c-gris3,#888);line-height:1.6">
          ${st.caidas > 0 ? `<strong style="color:#B02020">⚠ ${st.caidas} sistema${st.caidas>1?'s':''} sin conexión.</strong> Los datos mostrados son de la última carga exitosa.<br>` : ''}
          Para actualizar: ir a <a href="config.html" style="color:var(--ac,#8B1A1A);font-weight:600">Config → Importar datos</a>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    // Cerrar al hacer clic afuera
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!panel.contains(e.target) && !e.target.closest('#kk-fresh-badge')) {
          panel.remove(); document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }

  /* ─── Tooltip de frescura ───────────────────────────────────── */
  function _buildTooltip(st) {
    const lines = [`Frescura global: ${st.score}%`];
    st.integraciones.forEach(i => lines.push(`${i.sistema}: ${i.estado} (${i.freshness}%)`));
    if (st.caidas > 0) lines.push(`⚠ ${st.caidas} sistema(s) sin conexión`);
    return lines.join('\n');
  }

  /* ─── Registrar carga manual ────────────────────────────────── */
  async function recordManualSync(sistema, datos, usuario = null) {
    const entry = {
      sistema,
      fuente:    'manual',
      registros: datos?.length || 1,
      usuario:   usuario || sessionStorage.getItem('kausay_demo_nombre') || 'Sistema',
      timestamp: new Date().toISOString(),
    };

    // 1. Actualizar seed local
    if (typeof KausayDB !== 'undefined') {
      const db = JSON.parse(localStorage.getItem('kausay_db_v2') || '{}');
      if (!db.integraciones) db.integraciones = [];
      const idx = db.integraciones.findIndex(i => i.sistema === sistema);
      const now = Date.now();
      const freshScore = 100; // carga manual → frescura máxima
      if (idx >= 0) {
        db.integraciones[idx].estado     = 'activo';
        db.integraciones[idx].freshness  = freshScore;
        db.integraciones[idx].ultima_sync = now;
        db.integraciones[idx].error      = null;
      } else {
        db.integraciones.push({ sistema, estado:'activo', freshness:freshScore, ultima_sync:now, error:null });
      }
      localStorage.setItem('kausay_db_v2', JSON.stringify(db));
    }

    // 2. Supabase (si está activo)
    if (typeof KausayDB !== 'undefined' && KausayDB.CONFIG.USE_SUPABASE && KausayDB.SB_) {
      // UPDATE integraciones_sync_status
    }

    // 3. Audit trail
    if (typeof KausayDB !== 'undefined') {
      KausayDB.Audit.emit('importacion', sistema, `Carga manual ${sistema}`, 'import', null, entry);
      KausayDB.Telemetry.track('importacion_manual', { sistema, registros: entry.registros });
    }

    // 4. Propagar evento
    if (typeof KausayDB !== 'undefined') {
      KausayDB.EventBus.emit('sync:completado', { sistema, ...entry });
    }

    console.log('[Freshness] Manual sync recorded:', entry);
    return entry;
  }

  /* ─── Auto-patch del toolbar de cada dashboard ──────────────── */
  function autoMount() {
    // Inyectar en toolbar si existe el elemento .kk-tb
    const tb = document.querySelector('.kk-tb');
    if (!tb) return;
    const wrap = document.createElement('div');
    wrap.id = 'kk-fresh-wrap';
    wrap.style.cssText = 'display:flex;align-items:center;margin-left:auto;margin-right:8px';
    tb.insertBefore(wrap, tb.querySelector('.kk-tb__notif') || null);
    renderBadge('kk-fresh-wrap');
    // Banner solo si datos viejos
    const content = document.getElementById('content');
    if (content) renderBanner('content');
    // Escuchar actualizaciones de sync
    if (typeof KausayDB !== 'undefined') {
      KausayDB.EventBus.on('sync:completado', () => renderBadge('kk-fresh-wrap'));
    }
  }

  return { renderBadge, renderBanner, getStatus, recordManualSync, autoMount };
})();
