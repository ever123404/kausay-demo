/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — shared.js v2 API CONTRACT
   ─────────────────────────────────────────────────────────────────
   Contrato público de la interfaz de KausayDB.
   Este archivo es SOLO documentación — no ejecutar.
   Los dashboards importan shared.js y llaman KausayDB.método()
   sin conocer la implementación interna.
   ═══════════════════════════════════════════════════════════════════

   REGLAS DEL CONTRATO
   ───────────────────
   1. Ningún dashboard accede a LA (LocalAdapter) directamente.
   2. Ningún dashboard lee localStorage por su cuenta.
   3. Toda mutación de datos pasa por una función pública de KausayDB.
   4. Los eventos del EventBus son el único canal de sincronización reactiva.
   5. Al migrar a Supabase, SOLO cambia la implementación interna —
      los nombres, parámetros y retornos de este contrato NO cambian.

   ═══════════════════════════════════════════════════════════════════ */


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 0 — CONFIGURACIÓN Y SUB-SISTEMAS EXPUESTOS
// ─────────────────────────────────────────────────────────────────

KausayDB.CONFIG
// Objeto de solo lectura.
// Propiedades relevantes para dashboards:
//   USE_SUPABASE : boolean  — false en Etapas 1-3, true desde Etapa 4
//   TTL          : object   — tiempos de caché por entidad en ms

KausayDB.EventBus          // Ver Sección 8
KausayDB.WriteQueue        // Ver Sección 9
KausayDB.Audit             // Ver Sección 10
KausayDB.Telemetry         // Ver Sección 11


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 1 — MUNICIPALIDAD
// ─────────────────────────────────────────────────────────────────

KausayDB.getMuni()
// Retorna: { id, nombre, nombre_corto, tipo, ubigeo, departamento,
//            provincia, distrito, escudo_url, color_primario,
//            color_secundario, alcalde, secretaria, gm }
// Emite:   —
// Audita:  —
// Telemetría: —
// Supabase: SELECT * FROM municipalidades WHERE id = get_municipalidad_id()

KausayDB.setMuni(data)
// Params:  data — Partial<municipalidad>. Solo los campos a actualizar.
// Retorna: void
// Emite:   'muni:updated' → { ...municipalidad actualizada }
// Audita:  Audit.onUpdate('configuracion', id, 'Municipalidad', before, after)
// Telemetría: —
// Supabase: UPDATE municipalidades SET ... WHERE id = get_municipalidad_id()


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 2 — GERENCIAS
// ─────────────────────────────────────────────────────────────────

KausayDB.getGerencias()
// Retorna: Array<{ id, cod, nombre, jefe, color, ejec, activa }>
// Emite:   —
// Audita:  —
// Telemetría: —
// Supabase: SELECT * FROM gerencias WHERE municipalidad_id = get_municipalidad_id()

KausayDB.getGerencia(cod)
// Params:  cod — string  'INFRA' | 'RENTAS' | 'SERVICIOS' | 'SOCIAL' | 'SECRETARIA' | 'PLANIF'
// Retorna: { id, cod, nombre, jefe, color, ejec, activa } | undefined
// Emite:   —
// Audita:  —
// Supabase: SELECT * FROM gerencias WHERE cod = $cod AND municipalidad_id = ...

KausayDB.updateGerencia(cod, data)
// Params:  cod  — string  código de la gerencia
//          data — Partial<gerencia>
// Retorna: void
// Emite:   'gerencia:updated' → { cod, data }
// Audita:  Audit.onUpdate('gerencia', id, nombre, before, after)
// Supabase: UPDATE gerencias SET ... WHERE cod = $cod


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 3 — INSTRUCCIONES
// ─────────────────────────────────────────────────────────────────

KausayDB.getInstrucciones(para)
// Params:  para — string | null  código de gerencia o rol receptor.
//          Si null, retorna TODAS las instrucciones de la municipalidad.
// Retorna: Array<{
//   id, de, para, paraLabel, tipo, contenido, hora, ts,
//   confirmada, leida_en, respuesta, respondida_en, prioridad
// }>
// Filtro:  para === null → todas
//          para !== null → donde i.para === para OR i.de === para
// Emite:   —
// Audita:  —
// Supabase: SELECT * FROM instrucciones
//           WHERE municipalidad_id = get_municipalidad_id()
//           AND (receptor_id = $para_id OR emisor_id = $para_id)

KausayDB.addInstruccion(instr)
// Params:  instr — {
//   para:      string     código receptor ('GM', 'INFRA', etc.)
//   paraLabel: string     nombre legible del receptor
//   tipo:      string     'instruccion' | 'consulta' | 'alerta' | 'difusion' | 'coordinacion' | 'chat'
//   contenido: string     texto de la instrucción
//   prioridad: string     'urgente' | 'normal' | 'baja'
// }
// Retorna: instruccion creada con id, hora, ts asignados
// Emite:   'instruccion:nueva' → instruccion completa
// Audita:  Audit.onCreate('instruccion', id, '[tipo] -> paraLabel', instr)
// Telemetría: Telemetry.instruccionEnviada(tipo), Telemetry.firstAction()
// Efecto secundario: setTimeout 3h → si !confirmada → addAlerta(niv:'alerta')
// Supabase: INSERT INTO instrucciones ... + WQ.enqueue si USE_SUPABASE

KausayDB.confirmarInstruccion(id)
// Params:  id — string  id de la instrucción a confirmar
// Retorna: instruccion actualizada | undefined si no existe
// Emite:   'instruccion:confirmada' → { id }
// Audita:  Audit.onConfirm('instruccion', id, contenido[0..50], instr)
// Telemetría: Telemetry.instruccionConfirmada(horas_hasta_confirmar)
// Supabase: UPDATE instrucciones SET confirmada=true, leida_en=now() WHERE id=$id

KausayDB.responderInstruccion(id, respuesta)
// Params:  id        — string  id de la instrucción
//          respuesta — string  texto de la respuesta
// Retorna: instruccion actualizada | undefined si no existe
// Emite:   'instruccion:respondida' → { id, respuesta }
// Audita:  Audit.onRespond('instruccion', id, contenido[0..50], { respuesta })
// Supabase: UPDATE instrucciones SET respuesta=$r, confirmada=true, respondida_en=now()

KausayDB.getPendientesCount(para)
// Params:  para — string  código del receptor
// Retorna: number  — cantidad de instrucciones no confirmadas para ese receptor
// Emite:   —
// Audita:  —
// Supabase: SELECT COUNT(*) FROM instrucciones
//           WHERE receptor_id = $para_id AND confirmada = false


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 4 — COMPROMISOS
// ─────────────────────────────────────────────────────────────────

KausayDB.getCompromisos(resp)
// Params:  resp — string | null  código de gerencia responsable
//          Si null, retorna TODOS.
// Retorna: Array<{
//   id, desc, resp, origen, origen_ref, fec, ven, estado, prioridad
// }>
// Emite:   —
// Supabase: SELECT * FROM compromisos WHERE municipalidad_id = ...
//           [AND responsable_id = $resp_id]

KausayDB.addCompromiso(comp)
// Params:  comp — {
//   desc:       string  descripción del compromiso
//   resp:       string  código de gerencia responsable
//   origen:     string  'campo' | 'reunion' | 'concejo' | 'instruccion' | 'otro'
//   origen_ref: string  descripción del contexto
//   fec:        string  fecha límite 'YYYY-MM-DD'
//   prioridad:  string  'alta' | 'media' | 'baja'
// }
// Retorna: compromiso creado
// Emite:   'compromiso:nuevo' → compromiso completo
// Audita:  Audit.onCreate('compromiso', id, desc, comp)
// Telemetría: Telemetry.firstAction()
// Supabase: INSERT INTO compromisos ...

KausayDB.updateCompromiso(id, data)
// Params:  id   — string
//          data — Partial<compromiso>  { estado, evidencia, etc. }
// Retorna: compromiso actualizado | undefined
// Emite:   'compromiso:updated' → { id, data }
// Audita:  Audit.onUpdate('compromiso', id, desc, before, after)
// Supabase: UPDATE compromisos SET ... WHERE id=$id


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 5 — OBRAS
// ─────────────────────────────────────────────────────────────────

KausayDB.getObras(ger)
// Params:  ger — string | null  código de gerencia ('INFRA', etc.)
//          Si null, retorna TODAS.
// Retorna: Array<{
//   id, ger, nombre, estado, pct, presup, fin,
//   riesgo, dias_sin_av, contratista
// }>
// Supabase: SELECT * FROM obras WHERE municipalidad_id = ...
//           [AND gerencia_id = $ger_id]

KausayDB.updateAvanceObra(id, pct)
// Params:  id  — string   id de la obra
//          pct — number   nuevo porcentaje (0-100)
// Retorna: obra actualizada con riesgo recalculado
// Emite:   'obra:avance' → { id, pct, riesgo }
// Audita:  Audit.onUpdate('obra', id, nombre, {pct_ant, dias_sin_av_ant}, {pct, riesgo})
// Telemetría: Telemetry.obraActualizada()
// Efecto interno: recalcula riesgo via calcRiesgoObra(), resetea dias_sin_av a 0
// Supabase: UPDATE obras SET porcentaje_avance=$pct, dias_sin_av=0, riesgo_nivel=$r
//           + INSERT INTO avances_obra (historial)

KausayDB.calcRiesgoObra(obra)
// Params:  obra — objeto obra completo
// Retorna: 'critico' | 'alto' | 'medio' | 'bajo'
// Scoring: dias_sin_av>15 → +40pts, >7 → +20pts, >3 → +10pts
//          pct<30 en ejecucion → +30pts, pct<50 → +15pts
//          estado=paralizada → +30pts
//          ≥60pts='critico', ≥35='alto', ≥15='medio', <15='bajo'
// Emite:   —  (función pura, sin efectos secundarios)


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 6 — AGENDA, DOCUMENTOS, ALERTAS, PLAZOS, PRESUPUESTO
// ─────────────────────────────────────────────────────────────────

KausayDB.getAgenda()
// Retorna: Array<{ id, hora, dur, titulo, lugar, tipo, br, br_listo }>
// Ordenado por hora ASC

KausayDB.addAgenda(item)
// Params:  item — { hora, dur, titulo, lugar, tipo, br?, br_listo? }
// Retorna: agenda_item creado
// Emite:   'agenda:nueva' → item
// Audita:  Audit.onCreate('agenda_item', id, titulo, item)

KausayDB.getDocumentos()
// Retorna: Array<{ id, titulo, sub, tipo, urgencia, estado }>

KausayDB.addDocumento(doc)
// Params:  doc — { titulo, sub, tipo, urgencia }
// Retorna: documento creado con estado='pendiente'
// Emite:   'documento:nuevo' → doc
// Audita:  Audit.onCreate('documento_firma', id, titulo, doc)

KausayDB.updateDocumento(id, estado, motivo)
// Params:  id     — string
//          estado — 'aprobado' | 'devuelto'
//          motivo — string | null  (requerido si estado='devuelto')
// Retorna: documento actualizado
// Emite:   'documento:updated' → { id, estado }
// Audita:  Audit.onUpdate() + Audit.onApprove() si estado='aprobado'
// Supabase: UPDATE documentos_firma SET estado=$estado, motivo_devolucion=$motivo

KausayDB.getAlertas()
// Retorna: Array<alerta>  — todas, incluyendo leídas

KausayDB.getAlertasActivas()
// Retorna: Array<alerta>  — solo donde leida === false

KausayDB.addAlerta(alerta)
// Params:  alerta — { ico, titulo, desc, niv, area }
//          niv: 'critico' | 'alerta' | 'info'
// Retorna: alerta creada
// Emite:   'alerta:nueva' → alerta

KausayDB.marcarAlertaLeida(id)
// Emite:   'alerta:leida' → { id }
// Telemetría: Telemetry.alertaResuelta()

KausayDB.getPlazos()
// Retorna: Array<{ id, sistema, desc, dias, resp, niv }>

KausayDB.getCriticos()
// Retorna: Array<plazo>  — solo donde niv === 'critico'

KausayDB.getPresupuesto()
// Retorna: { total, ejecutado, pct_global, por_area: Array<{cod, nombre, asig, ejec, pct}> }

KausayDB.getPresupuestoArea(cod)
// Params:  cod — string  código de gerencia
// Retorna: { cod, nombre, asig, ejec, pct } | undefined

KausayDB.getIndicadores(cod)
// Params:  cod — string  código de gerencia
// Retorna: Array<{ n, v, meta, u }>

KausayDB.updateIndicador(cod, idx, valor)
// Params:  cod   — string  código de gerencia
//          idx   — number  índice del indicador en el array
//          valor — number  nuevo valor
// Emite:   'indicador:updated' → { cod, idx, valor }
// Audita:  Audit.onUpdate('indicador', key, nombre, {v_ant}, {v})

KausayDB.getIntegraciones()
// Retorna: Array<{ sistema, estado, freshness, ultima_sync, error }>
//          freshness: 0-100 (0=sin datos, 100=fresco)


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 7 — RESUMEN EJECUTIVO Y DECISIONES
// ─────────────────────────────────────────────────────────────────

KausayDB.getResumenEjecutivo()
// Retorna: {
//   alertas_criticas : number,
//   alertas_alerta   : number,
//   obras_criticas   : number,
//   obras_en_riesgo  : number,
//   compromisos_ven  : number,
//   docs_pendientes  : number,
//   instr_sin_leer   : number,
//   plazos_criticos  : number,
//   dias_mef         : number,
//   ejec_global      : number   (porcentaje 0-100),
//   agenda_hoy       : number,
//   estado           : 'critico' | 'alerta' | 'normal'
// }
// Uso: llamar en init de cada dashboard para estado inicial del badge/topbar

KausayDB.getDecisionesDelDia()
// Retorna: Array<{
//   id     : string,
//   tipo   : 'obra_critica' | 'plazo_critico' | 'concejo' | 'compromisos_vencidos' | 'firma_urgente',
//   ico    : string,
//   ttl    : string,
//   desc   : string,
//   tag    : string,
//   color  : string   (hex del color de urgencia),
//   accion : string   (label del CTA),
//   ref    : string | null  (id de la entidad relacionada)
// }>
// Máximo 5 elementos, ordenados por prioridad decreciente.
// Uso: widget "Decisiones del día" en todos los dashboards con acceso ejecutivo


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 8 — EVENT BUS
// ─────────────────────────────────────────────────────────────────

KausayDB.EventBus.on(evento, callback)
// Suscribirse a un evento. El callback recibe el payload del evento.
// Usar en window.addEventListener('load', ...) de cada dashboard.

KausayDB.EventBus.off(evento, callback)
// Desuscribirse. Llamar en cleanup si el componente se destruye.

KausayDB.EventBus.emit(evento, data)
// Emitir un evento local + BroadcastChannel (otras pestañas).
// Los dashboards NO deben emitir eventos directamente —
// solo escuchar. La emisión la hacen las funciones de KausayDB.

// CATÁLOGO COMPLETO DE EVENTOS
// ─────────────────────────────────────────────────────────────────
// Evento                    Payload                  Quién escucha
// ─────────────────────────────────────────────────────────────────
// 'instruccion:nueva'       instruccion completa     gm, gerente
// 'instruccion:confirmada'  { id }                   alcalde, gm
// 'instruccion:respondida'  { id, respuesta }        alcalde, gm
// 'compromiso:nuevo'        compromiso completo      gm, gerente
// 'compromiso:updated'      { id, data }             alcalde, gm
// 'obra:avance'             { id, pct, riesgo }      alcalde, gm
// 'alerta:nueva'            alerta completa          alcalde
// 'alerta:leida'            { id }                   —
// 'documento:nuevo'         documento completo       secretaria, alcalde
// 'documento:updated'       { id, estado }           secretaria
// 'agenda:nueva'            agenda_item              secretaria
// 'indicador:updated'       { cod, idx, valor }      gm
// 'gerencia:updated'        { cod, data }            gm, alcalde
// 'muni:updated'            municipalidad completa   todos
// 'wq:conflict'             { table }                todos (mostrar badge)
// 'app:offline'             {}                       todos (mostrar banner)
// 'remote:*'                cualquier payload        re-emitido de otras pestañas


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 9 — WRITE QUEUE
// ─────────────────────────────────────────────────────────────────

KausayDB.WriteQueue.pendingCount()
// Retorna: number — operaciones pendientes de sync con Supabase

KausayDB.WriteQueue.conflictCount()
// Retorna: number — operaciones en conflicto que requieren resolución manual

// NOTA: flush() se ejecuta automáticamente al detectar 'online'.
// Los dashboards NO deben llamar flush() directamente.
// Solo consultar pendingCount() y conflictCount() para mostrar badges.


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 10 — AUDIT (uso directo por dashboards: solo exportar)
// ─────────────────────────────────────────────────────────────────

KausayDB.exportarAuditLog()
// Retorna: Array<audit_evento>  — todos los eventos del buffer local
// Audita:  Audit.onExport('audit', 'auditoria', count)
// Uso: botón "Exportar log de auditoría" en config.html o panel de admin

// NOTA: Los dashboards NO llaman Audit.emit() directamente.
// El audit se dispara automáticamente dentro de cada función pública de KausayDB.
// KausayDB.Audit está expuesto SOLO para que config.html pueda hacer exportarAuditLog().


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 11 — TELEMETRY (uso directo por dashboards)
// ─────────────────────────────────────────────────────────────────

KausayDB.Telemetry.firstAction()
// Llamar en la PRIMERA acción intencional del usuario en la sesión.
// Registra Time-To-First-Action (TTFA).
// Idempotente — solo dispara una vez por sesión.

KausayDB.Telemetry.briefingAbierto()
// Llamar cuando el usuario abre un briefing de IA.

// Los demás métodos de telemetría se disparan automáticamente
// dentro de las funciones públicas de KausayDB.


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 12 — REALTIME (Etapa 4+)
// ─────────────────────────────────────────────────────────────────

KausayDB.subscribeRealtime(tabla, callback)
// Params:  tabla    — string  nombre de tabla en Supabase
//          callback — function(payload)  se ejecuta al recibir cambio
// Retorna: channel | null  (null si USE_SUPABASE=false)
// Uso en Etapa 4: agregar en window.addEventListener('load') de cada dashboard:
//
//   KausayDB.subscribeRealtime('instrucciones', payload => {
//     KausayDB.EventBus.emit('instruccion:nueva', payload.new);
//     render(); // o actualización granular
//   });
//
// En Etapas 1-3 el EventBus local + BroadcastChannel cubre el caso de múltiples pestañas.


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 13 — UTILIDADES
// ─────────────────────────────────────────────────────────────────

KausayDB.fmt(n)
// Params:  n — number | null
// Retorna: string formateada  null→'—' | ≥1M→'S/X.XM' | ≥1K→'S/XXK' | <1K→'S/X'

KausayDB.pctColor(p)
// Params:  p — number  0-100
// Retorna: string hex  ≥70→'#1A7A45' | ≥50→'#C8880A' | <50→'#B02020'

KausayDB.pctBg(p)
// Retorna: string hex de fondo semántico correspondiente a pctColor

KausayDB.pctLabel(p)
// Retorna: 'Normal' | 'En riesgo' | 'Crítico'

KausayDB.riesgoColor(r)
// Params:  r — 'critico' | 'alto' | 'medio' | 'bajo'
// Retorna: string hex del color semántico

KausayDB.relativeTime(ts)
// Params:  ts — number  timestamp en ms (Date.now())
// Retorna: string legible  'hace un momento' | 'hace Xmin' | 'hace Xh' | 'hace Xd'

KausayDB.reset()
// Borra TODO localStorage de Kausay y restaura datos seed.
// SOLO para desarrollo / onboarding. NUNCA llamar en producción.


// ─────────────────────────────────────────────────────────────────
// SECCIÓN 14 — PATRÓN DE USO EN CADA DASHBOARD
// ─────────────────────────────────────────────────────────────────

/*
TEMPLATE MÍNIMO — cada dashboard debe seguir este patrón:

  <script src="shared.js"></script>
  <script>

  // 1. Suscribirse a eventos relevantes ANTES del render
  KausayDB.EventBus.on('instruccion:nueva',   payload => render());
  KausayDB.EventBus.on('instruccion:confirmada', payload => render());
  KausayDB.EventBus.on('wq:conflict', ({ table }) => showConflictBadge());

  // 2. Inicializar en load
  window.addEventListener('load', () => {
    const muni   = KausayDB.getMuni();
    const nombre = sessionStorage.getItem('kausay_demo_nombre') || muni.alcalde;

    // Aplicar identidad institucional
    document.getElementById('muni-nombre').textContent = muni.nombre;
    document.getElementById('sb-av').textContent = iniciales(nombre);
    document.getElementById('sb-name').textContent = nombre;

    // Estado offline
    updateOnlineStatus();

    // Telemetría de apertura (ya la dispara shared.js automáticamente)
    // Solo registrar primera acción cuando el usuario interactúe

    // Render inicial
    render();

    // Service Worker
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('sw.js').catch(() => {});

    // Etapa 4: suscripciones Realtime
    // KausayDB.subscribeRealtime('instrucciones', cb);
  });

  // 3. Funciones de render leen de KausayDB — nunca de variables locales
  function render() {
    const r = KausayDB.getResumenEjecutivo();
    const instrucciones = KausayDB.getInstrucciones('GM');
    // ...
  }

  // 4. Acciones mutan via KausayDB — nunca directamente al DOM + localStorage
  function confirmar(id) {
    KausayDB.confirmarInstruccion(id);
    KausayDB.Telemetry.firstAction();
    render();
  }

  </script>
*/

// ─────────────────────────────────────────────────────────────────
// FIN DEL CONTRATO
// Versión: 2.0 | Compatible con: shared.js v2.0+
// Próxima actualización: Etapa 4 — agregar suscripciones Realtime
// ─────────────────────────────────────────────────────────────────
