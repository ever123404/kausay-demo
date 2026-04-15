/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — export.js v1.0
   ─────────────────────────────────────────────────────────────────
   Motor de exportación institucional. Todos los dashboards lo usan.

   CONTRATO PÚBLICO:
   KausayExport.csv(datos, nombre, columnas)      → descarga .csv
   KausayExport.excel(hojas, nombre)              → descarga .xlsx (SheetJS)
   KausayExport.print(htmlContent, titulo)        → ventana de impresión/PDF
   KausayExport.reporteEjecutivo(opciones)        → PDF ejecutivo completo
   KausayExport.reporteAsesor(opciones)           → briefing del asesor
   KausayExport.showMenu(containerId, modulos)    → menú de exportación en UI
   ═══════════════════════════════════════════════════════════════════ */

const KausayExport = (() => {

  /* ─── Helpers base ─────────────────────────────────────────── */
  function _getMuni() {
    return typeof KausayDB !== 'undefined' ? KausayDB.getMuni() : {};
  }
  function _getUser() {
    const sess = typeof KausayAuth !== 'undefined' ? KausayAuth.getSession() : null;
    return { nombre: sess?.nombre || 'Sistema', rol: sess?.rol || '—', email: sess?.email || '—' };
  }
  function _ts()   { return new Date().toISOString().slice(0,19).replace('T',' '); }
  function _slug() { return new Date().toISOString().slice(0,10); }
  function _sanitize(str) { return String(str||'').replace(/[\r\n,;"]/g,' ').trim(); }
  function _fmtN(n) { return typeof n==='number' ? n.toLocaleString('es-PE') : (n||'—'); }
  function _fmtS(n) {
    if (!n && n!==0) return '—';
    if (n>=1_000_000) return 'S/'+( n/1_000_000).toFixed(2)+'M';
    if (n>=1_000)     return 'S/'+(n/1_000).toFixed(1)+'K';
    return 'S/'+n.toLocaleString('es-PE');
  }

  /* ─── Audit de exportación ─────────────────────────────────── */
  function _auditExport(modulo, tipo, filtros={}, registros=0) {
    if (typeof KausayDB === 'undefined') return;
    KausayDB.Audit.onExport(modulo, tipo, registros);
    KausayDB.Telemetry.exportacionRealizada(modulo);
    console.log(`[Export] ${modulo} → ${tipo} (${registros} registros) por ${_getUser().nombre}`);
  }

  /* ─── DESCARGA de blob ─────────────────────────────────────── */
  function _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ═══════════════════════════════════════════════════════════
     CSV — universal, sin dependencias
  ═══════════════════════════════════════════════════════════ */
  function csv(datos, nombre, columnas) {
    if (!datos?.length) { _toast('Sin datos para exportar'); return; }
    const cols  = columnas || Object.keys(datos[0]);
    const header= cols.join(',');
    const rows  = datos.map(r => cols.map(c => `"${_sanitize(r[c])}"`).join(','));
    const muni  = _getMuni();
    const user  = _getUser();
    const meta  = [
      `# ${muni.nombre||'Kausay Municipal'} — ${nombre}`,
      `# Generado: ${_ts()} · Usuario: ${user.nombre} (${user.rol})`,
      `# Tenant: ${muni.ubigeo||muni.id||'—'}`,
      '',
    ].join('\n');
    const content = '\uFEFF' + meta + header + '\n' + rows.join('\n'); // BOM para Excel
    const blob = new Blob([content], { type:'text/csv;charset=utf-8;' });
    _download(blob, `${_slug()}_${nombre.replace(/\s+/g,'_').toLowerCase()}.csv`);
    _auditExport(nombre, 'CSV', {}, datos.length);
  }

  /* ═══════════════════════════════════════════════════════════
     EXCEL — usa SheetJS (cargado en index desde CDN)
  ═══════════════════════════════════════════════════════════ */
  async function excel(hojas, nombre) {
    // SheetJS se carga bajo demanda
    if (typeof XLSX === 'undefined') {
      await _loadSheetJS();
    }
    if (typeof XLSX === 'undefined') {
      // Fallback a CSV si SheetJS no carga
      _toast('⚠ Excel no disponible — exportando CSV');
      if (hojas[0]?.datos) csv(hojas[0].datos, nombre, hojas[0].columnas);
      return;
    }
    const wb = XLSX.utils.book_new();
    const muni = _getMuni();
    let totalRows = 0;
    hojas.forEach(hoja => {
      if (!hoja.datos?.length) return;
      // Agregar fila de metadatos al inicio
      const metaRow = [{ A: `${muni.nombre||'Kausay Municipal'} · ${hoja.nombre}` }];
      const metaRow2 = [{ A: `Generado: ${_ts()} · Usuario: ${_getUser().nombre}` }];
      const ws = XLSX.utils.json_to_sheet([]);
      // Escribir datos con encabezados
      XLSX.utils.sheet_add_aoa(ws, [[`${muni.nombre||'Municipalidad'} — ${hoja.nombre}`]], { origin:'A1' });
      XLSX.utils.sheet_add_aoa(ws, [[`Generado: ${_ts()}`]], { origin:'A2' });
      XLSX.utils.sheet_add_json(ws, hoja.datos, { origin:'A4', header: hoja.columnas });
      // Estilos básicos (ancho de columnas)
      const cols = hoja.columnas || Object.keys(hoja.datos[0]||{});
      ws['!cols'] = cols.map(c => ({ wch: Math.min(30, Math.max(10, c.length+5)) }));
      XLSX.utils.book_append_sheet(wb, ws, hoja.nombre.slice(0,31));
      totalRows += hoja.datos.length;
    });
    XLSX.writeFile(wb, `${_slug()}_${nombre.replace(/\s+/g,'_').toLowerCase()}.xlsx`);
    _auditExport(nombre, 'Excel', {}, totalRows);
  }

  async function _loadSheetJS() {
    return new Promise(resolve => {
      if (typeof XLSX !== 'undefined') { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload  = resolve;
      s.onerror = resolve; // resolve anyway, will fallback
      document.head.appendChild(s);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     PRINT / PDF — ventana de impresión con HTML institucional
  ═══════════════════════════════════════════════════════════ */
  function print(htmlContent, titulo) {
    const muni = _getMuni();
    const user = _getUser();
    const win  = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>${titulo} · ${muni.nombre_corto||'Kausay'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#111;background:#fff;padding:0}
  .print-header{background:${muni.color_primario||'#8B1A1A'};color:#fff;padding:16px 24px;display:flex;align-items:center;gap:14px}
  .print-header__escudo{width:40px;height:40px;object-fit:contain;filter:brightness(0) invert(1)}
  .print-header__muni{font-size:13pt;font-weight:700;line-height:1.2}
  .print-header__sub{font-size:9pt;opacity:.75;margin-top:2px}
  .print-header__right{margin-left:auto;text-align:right;font-size:9pt;opacity:.75}
  .print-body{padding:20px 24px}
  .print-footer{border-top:1px solid #ddd;padding:10px 24px;font-size:8pt;color:#888;display:flex;justify-content:space-between;margin-top:16px}
  h2{font-size:13pt;font-weight:700;color:${muni.color_primario||'#8B1A1A'};margin:16px 0 8px;border-bottom:1.5px solid ${muni.color_primario||'#8B1A1A'};padding-bottom:4px}
  h3{font-size:11pt;font-weight:700;margin:12px 0 5px;color:#333}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10pt}
  th{background:#f0f0f0;padding:5px 8px;text-align:left;font-weight:700;border:1px solid #ddd;font-size:9pt}
  td{padding:4px 8px;border:1px solid #ddd;vertical-align:top}
  tr:nth-child(even) td{background:#fafafa}
  .badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:8pt;font-weight:700}
  .badge-ok{background:#d4edda;color:#155724}
  .badge-warn{background:#fff3cd;color:#856404}
  .badge-danger{background:#f8d7da;color:#721c24}
  .badge-neutral{background:#e2e3e5;color:#383d41}
  .semaforo-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .semaforo-item{flex:1;min-width:80px;border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}
  .semaforo-val{font-size:20pt;font-weight:700;line-height:1}
  .semaforo-lbl{font-size:8pt;color:#666;margin-top:2px}
  .kpi-table{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
  .kpi-cell{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}
  .kpi-val{font-size:18pt;font-weight:700;color:${muni.color_primario||'#8B1A1A'}}
  .kpi-lbl{font-size:8pt;color:#666}
  .ranking-bar-bg{background:#eee;border-radius:4px;height:6px;margin-top:3px}
  .ranking-bar{height:6px;border-radius:4px;background:${muni.color_primario||'#8B1A1A'}}
  p{margin-bottom:6px;line-height:1.5}
  ul{margin-left:16px;margin-bottom:8px}
  li{margin-bottom:3px;line-height:1.5;font-size:10pt}
  @media print{
    body{padding:0}
    .print-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .no-print{display:none}
  }
</style>
</head><body>
<div class="print-header">
  <div><div class="print-header__muni">${muni.nombre||'Municipalidad'}</div>
       <div class="print-header__sub">Municipalidad ${muni.tipo||''} · ${muni.departamento||''}</div></div>
  <div class="print-header__right">${titulo}<br>${_ts()}<br>Usuario: ${user.nombre}</div>
</div>
<div class="print-body">${htmlContent}</div>
<div class="print-footer">
  <span>${muni.nombre||'Municipalidad'} · Kausay Municipal · Sistema de gestión municipal</span>
  <span>Generado: ${_ts()} · ${user.nombre} (${user.rol})</span>
</div>
<div class="no-print" style="padding:12px;text-align:center;background:#f0f0f0">
  <button onclick="window.print()" style="background:${muni.color_primario||'#8B1A1A'};color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:11pt;font-weight:600">🖨 Imprimir / Guardar como PDF</button>
  <button onclick="window.close()" style="margin-left:10px;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:11pt">✕ Cerrar</button>
</div>
</body></html>`);
    win.document.close();
    _auditExport(titulo, 'PDF/Print', {}, 1);
  }

  /* ═══════════════════════════════════════════════════════════
     REPORTE EJECUTIVO — para alcalde y GM
  ═══════════════════════════════════════════════════════════ */
  function reporteEjecutivo(opciones={}) {
    const db   = typeof KausayDB !== 'undefined';
    const r    = db ? KausayDB.getResumenEjecutivo()  : {};
    const gers = db ? KausayDB.getGerencias()         : [];
    const obras= db ? KausayDB.getObras()             : [];
    const comps= db ? KausayDB.getCompromisos()       : [];
    const pres = db ? KausayDB.getPresupuesto()       : {};
    const aler = db ? KausayDB.getAlertasActivas()    : [];
    const plaz = db ? KausayDB.getPlazos()            : [];
    const muni = _getMuni();

    const semColor = r.estado==='critico'?'#B02020':r.estado==='alerta'?'#C8880A':'#1A7A45';
    const semLabel = r.estado==='critico'?'CRÍTICO':r.estado==='alerta'?'EN ALERTA':'ESTABLE';

    const html = `
<h2>Estado general del municipio</h2>
<div class="kpi-table">
  ${[
    {v:semLabel,l:'Estado global',c:semColor},
    {v:(r.ejec_global||0)+'%',l:'Ejecución global',c:r.ejec_global>=70?'#1A7A45':r.ejec_global>=50?'#C8880A':'#B02020'},
    {v:r.alertas_criticas||0,l:'Alertas críticas',c:r.alertas_criticas>0?'#B02020':'#1A7A45'},
    {v:r.compromisos_ven||0,l:'Compromisos vencidos',c:r.compromisos_ven>0?'#C8880A':'#1A7A45'},
  ].map(k=>`<div class="kpi-cell"><div class="kpi-val" style="color:${k.c}">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('')}
</div>

${aler.length ? `
<h2>Alertas críticas activas (${aler.filter(a=>a.niv==='critico').length})</h2>
<table>
  <tr><th>Área</th><th>Alerta</th><th>Nivel</th></tr>
  ${aler.filter(a=>a.niv==='critico').slice(0,5).map(a=>`
  <tr><td>${a.area||'—'}</td><td>${a.titulo}</td>
      <td><span class="badge badge-danger">Crítico</span></td></tr>`).join('')}
</table>` : '<p style="color:#1A7A45">✓ Sin alertas críticas activas.</p>'}

${comps.filter(c=>c.ven||c.estado==='vencido').length ? `
<h2>Compromisos vencidos (${comps.filter(c=>c.ven||c.estado==='vencido').length})</h2>
<table>
  <tr><th>Compromiso</th><th>Responsable</th><th>Fecha límite</th><th>Prioridad</th></tr>
  ${comps.filter(c=>c.ven||c.estado==='vencido').slice(0,8).map(c=>`
  <tr><td>${c.desc}</td><td>${c.resp}</td><td>${c.fec}</td>
      <td><span class="badge ${c.prioridad==='alta'?'badge-danger':'badge-warn'}">${c.prioridad}</span></td></tr>`).join('')}
</table>` : ''}

${obras.filter(o=>['critico','alto'].includes(o.riesgo)).length ? `
<h2>Obras con riesgo crítico o alto</h2>
<table>
  <tr><th>Obra</th><th>Área</th><th>Avance</th><th>Estado</th><th>Presupuesto</th><th>Riesgo</th></tr>
  ${obras.filter(o=>['critico','alto'].includes(o.riesgo)).map(o=>`
  <tr><td>${o.nombre}</td><td>${o.ger}</td><td>${o.pct||0}%</td><td>${o.estado}</td>
      <td>${_fmtS(o.presup)}</td>
      <td><span class="badge ${o.riesgo==='critico'?'badge-danger':'badge-warn'}">${o.riesgo}</span></td></tr>`).join('')}
</table>` : ''}

<h2>Ranking de gerencias por ejecución presupuestal</h2>
<table>
  <tr><th>#</th><th>Gerencia</th><th>Asignado</th><th>Ejecutado</th><th>% Ejec.</th><th>Estado</th></tr>
  ${[...(pres.por_area||[])].sort((a,b)=>b.pct-a.pct).map((p,i)=>`
  <tr><td>${i+1}</td><td>${p.nombre||p.cod}</td>
      <td>${_fmtS(p.asig)}</td><td>${_fmtS(p.ejec)}</td>
      <td><div style="display:flex;align-items:center;gap:6px">
        <span style="font-weight:700;color:${p.pct>=70?'#1A7A45':p.pct>=50?'#C8880A':'#B02020'}">${p.pct}%</span>
        <div class="ranking-bar-bg" style="flex:1"><div class="ranking-bar" style="width:${Math.min(100,p.pct||0)}%;background:${p.pct>=70?'#1A7A45':p.pct>=50?'#C8880A':'#B02020'}"></div></div>
      </div></td>
      <td><span class="badge ${p.pct>=70?'badge-ok':p.pct>=50?'badge-warn':'badge-danger'}">${p.pct>=70?'Normal':p.pct>=50?'Alerta':'Crítico'}</span></td></tr>`).join('')}
  <tr style="font-weight:700;background:#f0f0f0">
    <td colspan="2"><strong>TOTAL MUNICIPIO</strong></td>
    <td>${_fmtS(pres.total)}</td><td>${_fmtS(pres.ejecutado)}</td>
    <td><strong>${pres.pct_global||0}%</strong></td><td></td></tr>
</table>

${plaz.filter(p=>p.niv==='critico').length ? `
<h2>Plazos normativos críticos</h2>
<table>
  <tr><th>Sistema</th><th>Descripción</th><th>Días restantes</th><th>Responsable</th></tr>
  ${plaz.filter(p=>p.niv==='critico').map(p=>`
  <tr><td>${p.sistema}</td><td>${p.desc}</td>
      <td><span class="badge badge-danger">${p.dias} días</span></td><td>${p.resp||'—'}</td></tr>`).join('')}
</table>` : ''}

<p style="color:#888;font-size:9pt;margin-top:20px">
  Este reporte es generado automáticamente por Kausay Municipal a partir de los datos del sistema
  en la fecha y hora indicadas. Los montos son en Soles peruanos (S/).
  Para información actualizada, consultar el sistema en línea.
</p>`;

    print(html, `Reporte ejecutivo — ${muni.nombre_corto||'Municipalidad'}`);
    _auditExport('reporte_ejecutivo', 'PDF/Print', opciones, 1);
  }

  /* ═══════════════════════════════════════════════════════════
     REPORTE ASESOR — briefing + radar
  ═══════════════════════════════════════════════════════════ */
  function reporteAsesor(opciones={}) {
    const db    = typeof KausayDB !== 'undefined';
    const r     = db ? KausayDB.getResumenEjecutivo() : {};
    const agenda= db ? KausayDB.getAgenda()           : [];
    const obras = db ? KausayDB.getObras()            : [];
    const comps = db ? KausayDB.getCompromisos()      : [];
    const instr = db ? KausayDB.getInstrucciones()    : [];
    const aler  = db ? KausayDB.getAlertasActivas()   : [];
    const plaz  = db ? KausayDB.getPlazos()           : [];
    const muni  = _getMuni();
    const user  = _getUser();

    const escalados = instr.filter(i=>i.tipo==='alerta'&&i.para==='alcalde');
    const compSens  = comps.filter(c=>(c.ven||c.estado==='vencido')&&c.prioridad==='alta');

    const html = `
<h2>Briefing del día — ${new Date().toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h2>
<p><strong>Preparado por:</strong> ${user.nombre} · <strong>Rol:</strong> Asesoría del Despacho</p>

<h3>📋 Agenda del alcalde</h3>
${agenda.length ? `<table>
  <tr><th>Hora</th><th>Evento</th><th>Lugar</th><th>Tipo</th><th>Briefing</th></tr>
  ${agenda.map(a=>`<tr><td><strong>${a.hora}</strong></td><td>${a.titulo}</td><td>${a.lugar||'—'}</td>
    <td><span class="badge badge-neutral">${a.tipo}</span></td>
    <td>${a.br_listo?'<span class="badge badge-ok">Listo</span>':a.br?'<span class="badge badge-warn">Pendiente</span>':'—'}</td></tr>`).join('')}
</table>` : '<p>Sin eventos en agenda hoy.</p>'}

<h3>⚠️ Radar de riesgos del día</h3>
${aler.filter(a=>a.niv==='critico').length ? `<ul>
  ${aler.filter(a=>a.niv==='critico').map(a=>`<li><strong>[${a.area||'General'}] ${a.titulo}</strong> — ${a.desc}</li>`).join('')}
</ul>` : '<p>✓ Sin alertas críticas.</p>'}
${obras.filter(o=>o.riesgo==='critico').length ? `
<strong>Obras en situación crítica:</strong>
<ul>${obras.filter(o=>o.riesgo==='critico').map(o=>`
  <li>${o.nombre} (${o.ger}) — ${o.estado==='paralizada'?'Paralizada '+o.dias_sin_av+'d':'Riesgo crítico'} · ${_fmtS(o.presup)}</li>`).join('')}</ul>` : ''}
${plaz.filter(p=>p.niv==='critico').length ? `
<strong>Plazos normativos vencen en menos de 15 días:</strong>
<ul>${plaz.filter(p=>p.niv==='critico').map(p=>`<li>${p.sistema}: ${p.desc} — <strong>${p.dias} días</strong></li>`).join('')}</ul>` : ''}

${compSens.length ? `
<h3>🤝 Compromisos políticamente sensibles</h3>
<table>
  <tr><th>Compromiso</th><th>Responsable</th><th>Vencimiento</th><th>Origen</th></tr>
  ${compSens.map(c=>`<tr><td>${c.desc}</td><td>${c.resp}</td><td>${c.fec}</td>
    <td><span class="badge badge-neutral">${c.origen||'—'}</span></td></tr>`).join('')}
</table>` : ''}

${escalados.length ? `
<h3>🚨 Temas escalados al alcalde</h3>
<table>
  <tr><th>Hora</th><th>Tema escalado</th><th>Prioridad</th></tr>
  ${escalados.slice(0,8).map(i=>`<tr><td>${i.hora}</td><td>${i.contenido.slice(0,120)}</td>
    <td><span class="badge ${i.prioridad==='urgente'?'badge-danger':'badge-warn'}">${i.prioridad}</span></td></tr>`).join('')}
</table>` : ''}

<h3>📊 Estado municipal resumido</h3>
<div class="kpi-table">
  ${[
    {v:(r.ejec_global||0)+'%',l:'Ejecución'},
    {v:r.obras_criticas||0,l:'Obras críticas'},
    {v:r.compromisos_ven||0,l:'Comp. vencidos'},
    {v:r.plazos_criticos||0,l:'Plazos críticos'},
  ].map(k=>`<div class="kpi-cell"><div class="kpi-val" style="font-size:16pt">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('')}
</div>
<p style="color:#888;font-size:9pt;margin-top:16px">
  Briefing generado el ${_ts()}. Solo para uso interno del despacho.
  No distribuir sin autorización del asesor responsable.
</p>`;

    print(html, `Briefing del asesor — ${new Date().toLocaleDateString('es-PE')}`);
    _auditExport('briefing_asesor', 'PDF/Print', opciones, 1);
  }

  /* ═══════════════════════════════════════════════════════════
     EXPORTACIONES MODULARES
  ═══════════════════════════════════════════════════════════ */

  const MODULOS = {
    instrucciones: {
      label: 'Instrucciones', ico: '📨',
      formatos: ['CSV', 'Excel', 'PDF'],
      getData() {
        return (KausayDB.getInstrucciones()||[]).map(i=>({
          'Fecha':          i.hora||'—',
          'De':             i.de==='alcalde'?'Alcalde':i.de,
          'Para':           i.paraLabel||i.para,
          'Tipo':           i.tipo,
          'Prioridad':      i.prioridad,
          'Contenido':      i.contenido?.slice(0,100),
          'Confirmada':     i.confirmada?'Sí':'No',
          'Respuesta':      i.respuesta||'—',
        }));
      },
    },
    compromisos: {
      label: 'Compromisos', ico: '🤝',
      formatos: ['CSV', 'Excel', 'PDF'],
      getData() {
        return (KausayDB.getCompromisos()||[]).map(c=>({
          'Descripción':    c.desc,
          'Responsable':    c.resp,
          'Fecha límite':   c.fec||'—',
          'Estado':         c.estado||'pendiente',
          'Prioridad':      c.prioridad||'media',
          'Origen':         c.origen||'—',
          'Vencido':        c.ven?'Sí':'No',
        }));
      },
    },
    obras: {
      label: 'Obras', ico: '🏗',
      formatos: ['CSV', 'Excel', 'PDF'],
      getData() {
        return (KausayDB.getObras()||[]).map(o=>({
          'Obra':           o.nombre,
          'Área':           o.ger,
          'Estado':         o.estado,
          'Avance (%)':     o.pct||0,
          'Presupuesto':    o.presup||0,
          'Vencimiento':    o.fin||'—',
          'Contratista':    o.contratista||'—',
          'Riesgo':         o.riesgo||'bajo',
          'Días sin avance':o.dias_sin_av||0,
        }));
      },
    },
    alertas: {
      label: 'Alertas', ico: '🚨',
      formatos: ['CSV', 'Excel'],
      getData() {
        return (KausayDB.getAlertas()||[]).map(a=>({
          'Título':         a.titulo,
          'Área':           a.area||'—',
          'Nivel':          a.niv,
          'Leída':          a.leida?'Sí':'No',
          'Fecha':          a.ts?new Date(a.ts).toLocaleDateString('es-PE'):'—',
          'Descripción':    a.desc||'—',
        }));
      },
    },
    presupuesto: {
      label: 'Presupuesto', ico: '💰',
      formatos: ['CSV', 'Excel', 'PDF'],
      getData() {
        const p = KausayDB.getPresupuesto();
        return (p.por_area||[]).map(a=>({
          'Gerencia':       a.nombre||a.cod,
          'Asignado (S/)':  a.asig||0,
          'Ejecutado (S/)': a.ejec||0,
          '% Ejecución':    a.pct||0,
          'Saldo (S/)':     (a.asig||0)-(a.ejec||0),
        }));
      },
    },
    auditoria: {
      label: 'Auditoría', ico: '📋',
      formatos: ['CSV'],
      getData() {
        return (KausayDB.exportarAuditLog()||[]).slice(-200).map(e=>({
          'Timestamp':      e.created_at||e.timestamp,
          'Usuario':        e.usuario_id?.slice(0,8)||'—',
          'Rol':            e.usuario_rol||'—',
          'Entidad':        e.entidad_tipo||'—',
          'Acción':         e.accion,
          'Label':          e.entidad_label?.slice(0,60)||'—',
        }));
      },
    },
  };

  /* ─── Exportar un módulo en el formato indicado ─────────── */
  async function exportModulo(moduloKey, formato) {
    const mod = MODULOS[moduloKey];
    if (!mod) { _toast('Módulo no encontrado'); return; }
    const datos = mod.getData();
    if (!datos?.length) { _toast(`Sin datos en ${mod.label}`); return; }
    const nombre = mod.label;

    if (formato === 'CSV') {
      csv(datos, nombre, Object.keys(datos[0]));
    } else if (formato === 'Excel') {
      await excel([{ nombre, datos, columnas: Object.keys(datos[0]) }], nombre);
    } else if (formato === 'PDF') {
      const tabla = `
        <h2>${mod.ico} ${nombre}</h2>
        <table>
          <tr>${Object.keys(datos[0]).map(c=>`<th>${c}</th>`).join('')}</tr>
          ${datos.slice(0,50).map(r=>`<tr>${Object.values(r).map(v=>`<td>${v||'—'}</td>`).join('')}</tr>`).join('')}
          ${datos.length>50?`<tr><td colspan="${Object.keys(datos[0]).length}" style="text-align:center;color:#888;font-style:italic">...y ${datos.length-50} registros más</td></tr>`:''}
        </table>`;
      print(tabla, `${nombre} — ${_getMuni().nombre_corto||'Municipalidad'}`);
    }
  }

  /* ─── Menú de exportación en UI ─────────────────────────── */
  function showMenu(containerId, modulosActivos, onClose) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const old = document.getElementById('kk-export-menu');
    if (old) { old.remove(); if(onClose)onClose(); return; }

    const menu = document.createElement('div');
    menu.id = 'kk-export-menu';
    menu.style.cssText = `
      position:absolute;right:0;top:calc(100% + 6px);z-index:120;
      background:var(--c-card,#fff);border:1px solid var(--c-borde,#eee);
      border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);
      padding:10px;min-width:240px;font-family:var(--f-sans,'system-ui');
    `;
    menu.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:var(--c-gris3,#888);text-transform:uppercase;letter-spacing:1px;padding:0 4px 8px;border-bottom:1px solid var(--c-borde,#eee);margin-bottom:8px">Exportar datos</div>
      ${modulosActivos.map(k=>{
        const mod=MODULOS[k]; if(!mod)return'';
        return `<div style="margin-bottom:6px">
          <div style="font-size:11px;font-weight:600;color:var(--c-negro,#111);padding:0 4px;margin-bottom:4px">${mod.ico} ${mod.label}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${mod.formatos.map(f=>`
              <button onclick="KausayExport.exportModulo('${k}','${f}');document.getElementById('kk-export-menu')?.remove()"
                style="padding:3px 10px;border-radius:7px;border:1px solid var(--c-borde,#eee);background:var(--c-bg,#f8f8f8);font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--c-gris2,#555)">${f}</button>`).join('')}
          </div>
        </div>`;
      }).join('')}
      <div style="border-top:1px solid var(--c-borde,#eee);margin-top:8px;padding-top:8px">
        <button onclick="KausayExport.reporteEjecutivo();document.getElementById('kk-export-menu')?.remove()"
          style="width:100%;padding:7px;border-radius:8px;background:var(--ac,#8B1A1A);color:#fff;border:none;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">
          🖨 Reporte ejecutivo completo
        </button>
      </div>
    `;
    el.style.position='relative';
    el.appendChild(menu);
    setTimeout(()=>{
      document.addEventListener('click',function h(e){
        if(!menu.contains(e.target)&&!el.contains(e.target)){menu.remove();document.removeEventListener('click',h);}
      });
    },100);
  }

  /* ─── Toast interno ─────────────────────────────────────── */
  function _toast(msg) {
    const t=document.getElementById('toast');
    if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
    else { console.log('[Export]',msg); }
  }

  /* ─── Botón de exportación standarizado ─────────────────── */
  function renderExportBtn(containerId, modulosActivos) {
    const container=document.getElementById(containerId);
    if(!container||document.getElementById('kk-export-btn')) return;
    const btn=document.createElement('button');
    btn.id='kk-export-btn';
    btn.style.cssText='display:flex;align-items:center;gap:5px;padding:5px 11px;background:var(--c-card,#fff);border:1px solid var(--c-borde,#eee);border-radius:9px;font-family:var(--f-sans,"system-ui");font-size:11px;font-weight:600;color:var(--c-gris2,#555);cursor:pointer;transition:.15s';
    btn.innerHTML='<span>⬇</span><span>Exportar</span>';
    btn.onclick=()=>showMenu(containerId,modulosActivos);
    container.appendChild(btn);
  }

  return { csv, excel, print, reporteEjecutivo, reporteAsesor, exportModulo, showMenu, renderExportBtn, MODULOS };
})();
