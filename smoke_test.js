/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — smoke_test.js
   Frente 6: Prueba extremo a extremo (ejecutar en consola del browser)
   Requiere USE_SUPABASE=true y sesión activa.
   ═══════════════════════════════════════════════════════════════════
   Uso:
     1. Abrir alcalde.html con Supabase activo
     2. Abrir consola del browser (F12)
     3. Copiar y pegar este script completo
     4. Verificar resultados
   ═══════════════════════════════════════════════════════════════════ */

(async function runSmokeTest() {
  const LOG   = (msg, ok=true) => console.log(`${ok?'✓':'✗'} ${msg}`);
  const WARN  = (msg)          => console.warn(`⚠ ${msg}`);
  const FAIL  = (msg)          => { console.error(`✗ FALLO: ${msg}`); fails++; };
  const HR    = ()             => console.log('─'.repeat(60));
  let fails = 0;
  let instrId = null;

  console.log('\n KAUSAY SMOKE TEST — Inicio:', new Date().toLocaleTimeString());
  HR();

  // ── TEST 1: Sesión activa ────────────────────────────────────────
  console.log('\n[1] AUTENTICACIÓN');
  const sess = KausayAuth.getSession();
  if (!sess)            { FAIL('Sin sesión activa — login primero'); return; }
  if (!sess.activo)     { FAIL('Sesión inactiva'); return; }
  LOG(`Sesión válida: ${sess.nombre} (${sess.rol})`);
  LOG(`Municipalidad: ${sess.municipalidad_id}`);
  LOG(`MFA verificado: ${sess.mfa_verified}`);

  // ── TEST 2: Conectividad Supabase ────────────────────────────────
  console.log('\n[2] CONECTIVIDAD');
  if (!KausayDB.CONFIG.USE_SUPABASE) { WARN('USE_SUPABASE=false — tests en modo local'); }
  else LOG('USE_SUPABASE=true');

  // ── TEST 3: get_resumen_ejecutivo (RPC) ─────────────────────────
  console.log('\n[3] RPC: get_resumen_ejecutivo');
  try {
    const r = await KausayDB.getResumenEjecutivoAsync();
    if (!r) { FAIL('getResumenEjecutivoAsync retornó null'); }
    else {
      LOG(`Estado global: ${r.estado}`);
      LOG(`Alertas críticas: ${r.alertas_criticas}`);
      LOG(`Ejecución global: ${r.ejec_global}%`);
      LOG(`Decisiones del día: ${r.decisiones?.length || 0}`);
      if (typeof r.estado !== 'string') FAIL('estado no es string');
      if (typeof r.ejec_global !== 'number') FAIL('ejec_global no es number');
    }
  } catch(e) { FAIL('getResumenEjecutivoAsync exception: ' + e.message); }

  // ── TEST 4: get_badges_rol (RPC) ─────────────────────────────────
  console.log('\n[4] RPC: get_badges_rol');
  try {
    const b = await KausayDB.getBadgesAsync();
    if (!b) { WARN('getBadgesAsync retornó null — usando local'); }
    else {
      LOG(`Badges: alertas=${b.alertas} instrucciones=${b.instrucciones} firmas=${b.firmas}`);
    }
  } catch(e) { FAIL('getBadgesAsync: ' + e.message); }

  // ── TEST 5: gerencias_resumen_view ─────────────────────────────
  console.log('\n[5] VIEW: gerencias_resumen_view');
  try {
    const gers = KausayDB.getGerenciasResumen();
    if (!gers || !gers.length) { WARN('getGerenciasResumen vacío — puede ser modo local'); }
    else {
      LOG(`Gerencias: ${gers.length}`);
      const g0 = gers[0];
      LOG(`Primera: ${g0.nombre} (${g0.cod}) — ${g0.pct_ejecucion}% — ${g0.estado_semaforo}`);
      if (!g0.estado_semaforo) FAIL('estado_semaforo no calculado');
    }
  } catch(e) { FAIL('getGerenciasResumen: ' + e.message); }

  // ── TEST 6: Lectura real desde Supabase ─────────────────────────
  console.log('\n[6] LECTURA: instrucciones');
  try {
    const instrs = KausayDB.getInstrucciones();
    LOG(`Instrucciones cargadas: ${instrs.length}`);
    if (instrs.length > 0) {
      const i0 = instrs[0];
      LOG(`Primera: id=${i0.id?.slice(0,8)} tipo=${i0.tipo} confirmada=${i0.confirmada}`);
      if (!i0.id)   FAIL('instruccion sin id');
      if (!i0.tipo) FAIL('instruccion sin tipo');
    }
  } catch(e) { FAIL('getInstrucciones: ' + e.message); }

  // ── TEST 7: Escritura real — emitir instrucción ──────────────────
  console.log('\n[7] ESCRITURA: addInstruccion (smoke test)');
  try {
    const nueva = await KausayDB.addInstruccion({
      para:      'GM',
      paraLabel: 'Gerente Municipal',
      tipo:      'instruccion',
      contenido: '[SMOKE TEST] Instrucción de prueba — ignorar. ' + new Date().toISOString(),
      prioridad: 'baja',
    });
    if (!nueva || !nueva.id) { FAIL('addInstruccion no retornó objeto con id'); }
    else {
      instrId = nueva.id;
      LOG(`Instrucción creada: ${instrId?.slice(0,8)}...`);
    }
  } catch(e) { FAIL('addInstruccion: ' + e.message); }

  // ── TEST 8: Auditoría generada ────────────────────────────────────
  console.log('\n[8] AUDITORÍA');
  try {
    const log = KausayDB.exportarAuditLog();
    const ultimo = log[log.length - 1];
    if (!ultimo) { FAIL('Audit log vacío'); }
    else {
      LOG(`Último evento: ${ultimo.accion} en ${ultimo.entidad_tipo}`);
      LOG(`Usuario_id: ${ultimo.usuario_id}`);
      LOG(`Timestamp: ${ultimo.created_at}`);
      if (!ultimo.accion)     FAIL('accion no registrada');
      if (!ultimo.usuario_id) FAIL('usuario_id no registrado');
    }
  } catch(e) { FAIL('exportarAuditLog: ' + e.message); }

  // ── TEST 9: Telemetría registrada ─────────────────────────────────
  console.log('\n[9] TELEMETRÍA');
  try {
    const tel = JSON.parse(localStorage.getItem('kausay_telemetry') || '[]');
    const ultimo = tel[tel.length - 1];
    if (!ultimo) { WARN('Telemetría local vacía'); }
    else {
      LOG(`Último evento: ${ultimo.ev} (${ultimo.rol})`);
    }
  } catch(e) { FAIL('Telemetría: ' + e.message); }

  // ── TEST 10: WriteQueue estado ─────────────────────────────────────
  console.log('\n[10] WRITE QUEUE');
  const pending   = KausayDB.WriteQueue.pendingCount();
  const conflicts = KausayDB.WriteQueue.conflictCount();
  LOG(`Pendientes: ${pending}`);
  if (conflicts > 0) WARN(`Conflictos en WQ: ${conflicts}`);
  else LOG(`Conflictos: 0`);

  // ── TEST 11: Comportamiento offline ────────────────────────────────
  console.log('\n[11] OFFLINE RESILIENCE');
  LOG(`navigator.onLine: ${navigator.onLine}`);
  LOG(`LocalAdapter data keys: ${Object.keys(JSON.parse(localStorage.getItem('kausay_db_v2')||'{}')).length}`);
  // Verificar que getResumenEjecutivo() funciona síncronamente (fallback)
  try {
    const r = KausayDB.getResumenEjecutivo(); // síncrono
    LOG(`Resumen local (síncrono): estado=${r.estado} ejec=${r.ejec_global}%`);
  } catch(e) { FAIL('getResumenEjecutivo síncrono: ' + e.message); }

  // ── TEST 12: Realtime subscription ─────────────────────────────────
  console.log('\n[12] REALTIME');
  if (!KausayDB.CONFIG.USE_SUPABASE) {
    WARN('Realtime solo disponible con USE_SUPABASE=true');
  } else {
    let rtReceived = false;
    const ch = KausayDB.subscribeRealtime('instrucciones', (payload) => {
      rtReceived = true;
      LOG(`Realtime evento: ${payload.eventType} en instrucciones`);
      KausayDB.unsubscribeRealtime('instrucciones');
    });
    LOG(`Canal Realtime instrucciones: ${ch ? 'suscrito' : 'null (modo local)'}`);
  }

  // ── RESULTADO FINAL ─────────────────────────────────────────────
  HR();
  console.log('\n RESULTADO SMOKE TEST');
  if (fails === 0) {
    console.log('✅ TODOS LOS TESTS PASARON — GO para piloto controlado');
  } else {
    console.log(`❌ ${fails} FALLO(S) — NO GO — revisar antes de piloto`);
  }
  console.log(' Instrucción smoke test creada con id:', instrId?.slice(0,8) || 'N/A');
  console.log(' Fin:', new Date().toLocaleTimeString());
  HR();

  return { fails, instrId };
})();
