/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — branding.js v1.0
   ─────────────────────────────────────────────────────────────────
   Módulo de branding multi-tenant.
   Carga y aplica la identidad institucional desde KausayDB.getMuni().
   Todos los dashboards llaman KausayBranding.apply() en su load().

   CONTRATO:
   - Lee siempre de KausayDB.getMuni() — nunca hardcode
   - Aplica: --ac, --ac-bg, --ac-brd, theme-color, título, escudo
   - Propaga cambios via EventBus 'muni:updated'
   - Compatible con USE_SUPABASE=true (carga async desde Supabase)
   - No requiere código de Cajamarca en ningún dashboard
   ═══════════════════════════════════════════════════════════════════ */

const KausayBranding = (() => {

  /* ─── Colores de acento por ROL (no cambian con el tenant) ──── */
  const ROL_COLORS = {
    alcalde:            '#8B1A1A',
    secretaria:         '#9E6A06',
    gerente_municipal:  '#185FA5',
    gerente_sectorial:  null,     // color de la gerencia — dinámico
    asesor_despacho:    '#8B1A1A',
    planeamiento:       '#2E6B5E',
    oci_lectura:        '#3D6E40',
    soporte_kausay:     '#3A5A8C',
  };

  /* ─── Colores derivados (light bg + border) ─────────────────── */
  function _derivedColors(hex) {
    // Convierte hex a rgba con opacidad para bg y brd
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return {
      bg:  `rgba(${r},${g},${b},.10)`,
      brd: `rgba(${r},${g},${b},.22)`,
    };
  }

  /* ─── Aplicar variables CSS ─────────────────────────────────── */
  function _applyCSSVars(acColor) {
    if (!acColor || !/^#[0-9A-Fa-f]{6}$/.test(acColor)) return;
    const d = _derivedColors(acColor);
    const root = document.documentElement;
    root.style.setProperty('--ac',     acColor);
    root.style.setProperty('--ac-bg',  d.bg);
    root.style.setProperty('--ac-brd', d.brd);
    // theme-color para barra del navegador en mobile
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', acColor);
  }

  /* ─── Aplicar escudo ────────────────────────────────────────── */
  function _applyEscudo(url) {
    if (!url) return;
    // Todos los escudos en el DOM con clases conocidas
    document.querySelectorAll(
      '.kk-sb__escudo, .ix-escudo, .escudo, img[alt*="Escudo"], img[alt*="escudo"]'
    ).forEach(img => {
      img.src = url;
      img.style.display = '';
    });
  }

  /* ─── Aplicar nombre institucional ─────────────────────────── */
  function _applyNombres(muni) {
    const nombre       = muni.nombre       || 'Municipalidad';
    const nombre_corto = muni.nombre_corto || nombre;
    const tipo         = muni.tipo         || 'municipal';

    // Selectores de nombre en todos los dashboards
    ['.kk-sb__muni','#sb-muni','#ix-muni-nombre','#muni-nombre'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.textContent = nombre; });
    });
    // Tipo
    ['#ix-muni-tipo'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.textContent = `Municipalidad ${tipo} · Región ${muni.departamento||''}`;
      });
    });
    // Footer
    ['#foot-muni'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.textContent = nombre; });
    });
    // Título de pestaña — preservar sufijo del dashboard
    const currentTitle = document.title;
    const suffix = currentTitle.includes('·') ? currentTitle.split('·').slice(1).join('·').trim() : '';
    document.title = suffix ? `${nombre_corto} · ${suffix}` : nombre_corto;
  }

  /* ─── Función principal ─────────────────────────────────────── */
  function apply(options = {}) {
    const {
      rol          = sessionStorage.getItem('kausay_demo_rol') || 'alcalde',
      gerenciaColor = null,  // color de la gerencia (para gerente_sectorial)
      async: runAsync = false,
    } = options;

    // Determinar color de acento
    let acColor = ROL_COLORS[rol] || '#185FA5';
    if (rol === 'gerente_sectorial' && gerenciaColor) {
      acColor = gerenciaColor;
    }

    // Aplicar CSS vars con color del rol inmediatamente (no esperar Supabase)
    _applyCSSVars(acColor);

    // Aplicar branding del municipio desde KausayDB
    const applyFromMuni = (muni) => {
      if (!muni) return;
      // El color primario del tenant NO sobreescribe el color del rol
      // Solo se usa en index.html donde no hay rol activo
      if (rol === 'none' || rol === 'public') {
        _applyCSSVars(muni.color_primario || acColor);
      }
      _applyNombres(muni);
      _applyEscudo(muni.escudo_url || 'escudo.png');
    };

    if (runAsync && typeof KausayDB !== 'undefined' && KausayDB.CONFIG.USE_SUPABASE) {
      // Aplicar local primero (no bloquea), luego refrescar con Supabase
      const localMuni = KausayDB.getMuni();
      applyFromMuni(localMuni);
      KausayDB.loadInitialData().then(() => {
        applyFromMuni(KausayDB.getMuni());
      }).catch(() => {});
    } else if (typeof KausayDB !== 'undefined') {
      applyFromMuni(KausayDB.getMuni());
    }

    // Escuchar cambios de branding propagados via EventBus
    if (typeof KausayDB !== 'undefined') {
      KausayDB.EventBus.on('muni:updated', (muni) => applyFromMuni(muni));
    }
  }

  /* ─── Para index.html (sin rol activo) ──────────────────────── */
  function applyPublic() {
    apply({ rol: 'public', async: true });
    // index.html usa el color primario del tenant para el header
    if (typeof KausayDB !== 'undefined') {
      const muni = KausayDB.getMuni();
      _applyCSSVars(muni.color_primario || '#8B1A1A');
    }
  }

  /* ─── Para gerente.html (color dinámico de su gerencia) ─────── */
  function applyGerente(gerenciaCod) {
    if (!gerenciaCod || typeof KausayDB === 'undefined') {
      apply({ rol: 'gerente_sectorial' });
      return;
    }
    const ger = KausayDB.getGerencia(gerenciaCod);
    apply({ rol: 'gerente_sectorial', gerenciaColor: ger?.color });
    // Aplicar también al sidebar tag
    const tag = document.getElementById('sb-tag');
    if (tag && ger) tag.textContent = ger.nombre;
  }

  /* ─── Validate tenant isolation ─────────────────────────────── */
  function validateTenantIsolation() {
    const session  = typeof KausayAuth !== 'undefined' ? KausayAuth.getSession() : null;
    const muni     = typeof KausayDB   !== 'undefined' ? KausayDB.getMuni()       : null;
    const muniId   = sessionStorage.getItem('kausay_muni_id');

    return {
      session_muni_id: session?.municipalidad_id || null,
      db_muni_id:      muni?.id                 || null,
      session_storage: muniId                    || null,
      isolated:        session && muni ? session.municipalidad_id === muni.id : null,
      consistent:      session && muniId ? session.municipalidad_id === muniId : null,
    };
  }

  /* ─── Exportar ─────────────────────────────────────────────── */
  return { apply, applyPublic, applyGerente, validateTenantIsolation, ROL_COLORS };

})();
