/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — shared.js v3.0
   ─────────────────────────────────────────────────────────────────
   Migración progresiva: LocalAdapter (demo) ↔ SupabaseAdapter (prod)
   API pública idéntica a v2. Los dashboards no cambian.
   ─────────────────────────────────────────────────────────────────
   CAMBIOS v3 vs v2:
   - SupabaseAdapter con queries reales (antes era stub vacío)
   - subscribeRealtime() implementado por tabla con canal por tenant
   - Cache layer con TTL por entidad e invalidación selectiva
   - WriteQueue con flush real hacia Supabase y retry exponencial
   - Manejo de errores con fallback a LocalAdapter si Supabase falla
   - Función _mapRow() que normaliza los nombres de columna SQL→JS
   - Inicialización async: loadInitialData() carga de Supabase al arrancar
   ═══════════════════════════════════════════════════════════════════ */

const KausayDB = (() => {

  /* ─────────────────────────────────────────────────────────────
     CONFIG — único switch de infraestructura
  ───────────────────────────────────────────────────────────────*/
  const CONFIG = {
    SUPABASE_URL:  window.__KAUSAY_SUPABASE_URL__  || 'TU_SUPABASE_URL',
    SUPABASE_KEY:  window.__KAUSAY_SUPABASE_KEY__  || 'TU_SUPABASE_ANON_KEY',
    USE_SUPABASE:  window.__KAUSAY_USE_SUPABASE__  || false,
    // TTL de caché por entidad (ms). Con Supabase Realtime estos valores
    // sólo aplican como "tiempo máximo de datos stale" en caso de desconexión.
    TTL: {
      alertas:        5 * 60_000,
      instrucciones: 10 * 60_000,
      agenda:        60 * 60_000,
      compromisos:   30 * 60_000,
      obras:         15 * 60_000,
      presupuesto:  120 * 60_000,
      indicadores:  240 * 60_000,
      plazos:       360 * 60_000,
    },
    // Retry exponencial para WriteQueue
    WQ_BASE_DELAY_MS:  1_000,
    WQ_MAX_RETRIES:    5,
    WQ_MAX_DELAY_MS:   30_000,
  };

  /* ─────────────────────────────────────────────────────────────
     SEED DATA — fuente de datos en Etapas 1-3 (LocalAdapter)
  ───────────────────────────────────────────────────────────────*/
  const SEED = {
    municipalidad: {
      id:'muni-cajamarca-001', nombre:'Municipalidad Provincial de Cajamarca',
      nombre_corto:'MPC Cajamarca', tipo:'provincial', ubigeo:'060101',
      departamento:'Cajamarca', provincia:'Cajamarca', distrito:'Cajamarca',
      escudo_url:'escudo.png', color_primario:'#8B1A1A', color_secundario:'#1A1D23',
      alcalde:'Roberto Sánchez Quiroz', secretaria:'Carmen Flores Ríos',
      gm:'Mg. Carlos Vásquez Díaz',
    },
    gerencias:[
      {id:'ger-infra',      cod:'INFRA',      nombre:'Infraestructura y Obras',   jefe:'Ing. Ana Quispe Herrera',  color:'#0F6E56',ejec:71,activa:true},
      {id:'ger-rentas',     cod:'RENTAS',     nombre:'Rentas y Tributación',       jefe:'Cont. Carlos Herrera D.',  color:'#185FA5',ejec:41,activa:true},
      {id:'ger-servicios',  cod:'SERVICIOS',  nombre:'Servicios Municipales',      jefe:'Lic. Rosa Castro Vega',    color:'#5C3E8F',ejec:56,activa:true},
      {id:'ger-social',     cod:'SOCIAL',     nombre:'Desarrollo Social',          jefe:'Lic. Marco Torres León',   color:'#B5540A',ejec:78,activa:true},
      {id:'ger-secretaria', cod:'SECRETARIA', nombre:'Secretaría General',         jefe:'Abg. Patricia Abanto R.',  color:'#4A4A70',ejec:68,activa:true},
      {id:'ger-planif',     cod:'PLANIF',     nombre:'Planeamiento y Presupuesto', jefe:'Econ. Eduardo Lima Soto',  color:'#2E6B5E',ejec:39,activa:true},
    ],
    instrucciones:[
      {id:'ins-001',de:'alcalde',para:'GM',paraLabel:'Gerente Municipal',tipo:'instruccion',contenido:'Convocar urgente al contratista de Jr. Lima para mañana 9am.',hora:'09:15',ts:Date.now()-3600000,confirmada:false,respuesta:'',prioridad:'urgente'},
      {id:'ins-002',de:'alcalde',para:'PLANIF',paraLabel:'Planeamiento',tipo:'consulta',contenido:'¿Cuánto saldo sin ejecutar queda en Planeamiento?',hora:'Ayer 16:40',ts:Date.now()-86400000,confirmada:true,respuesta:'Saldo de S/1.2M. Preparando plan.',prioridad:'normal'},
      {id:'ins-003',de:'alcalde',para:'RENTAS',paraLabel:'Rentas',tipo:'instruccion',contenido:'Necesito el informe de recaudación de octubre a más tardar hoy.',hora:'08:30',ts:Date.now()-7200000,confirmada:false,respuesta:'',prioridad:'urgente'},
    ],
    compromisos:[
      {id:'com-001',desc:'Gestionar agua potable sector Los Pinos',resp:'SERVICIOS',origen:'campo',origen_ref:'Comunidad Los Pinos',fec:'2024-11-22',ven:true,estado:'vencido',prioridad:'alta'},
      {id:'com-002',desc:'Instalar alumbrado plaza Las Torrecitas',resp:'INFRA',origen:'campo',origen_ref:'Visita 18 nov',fec:'2024-11-25',ven:true,estado:'vencido',prioridad:'alta'},
      {id:'com-003',desc:'Responder pedido regidor Mamani — vías',resp:'GM',origen:'concejo',origen_ref:'Sesión 15 nov',fec:'2024-11-28',ven:false,estado:'pendiente',prioridad:'media'},
      {id:'com-004',desc:'Informe de cierre de año al concejo',resp:'PLANIF',origen:'concejo',origen_ref:'Acuerdo N°88',fec:'2024-12-05',ven:false,estado:'pendiente',prioridad:'media'},
    ],
    obras:[
      {id:'obra-001',ger:'INFRA',nombre:'Pavimentación Jr. Lima cuadra 8-12',estado:'paralizada',pct:34,presup:480000,fin:'2024-12-15',riesgo:'critico',dias_sin_av:26,contratista:'Constructora Lima SAC'},
      {id:'obra-002',ger:'INFRA',nombre:'Construcción mercado La Colmena',estado:'ejecucion',pct:68,presup:1200000,fin:'2025-02-28',riesgo:'medio',dias_sin_av:3,contratista:'Edificaciones Norte SRL'},
      {id:'obra-003',ger:'INFRA',nombre:'Red agua potable sector norte',estado:'ejecucion',pct:51,presup:680000,fin:'2025-03-31',riesgo:'medio',dias_sin_av:5,contratista:'Hidráulica Andina EIRL'},
      {id:'obra-004',ger:'SERVICIOS',nombre:'Planta residuos sólidos zona este',estado:'ejecucion',pct:38,presup:2100000,fin:'2025-09-30',riesgo:'alto',dias_sin_av:8,contratista:'EcoPerú SAC'},
      {id:'obra-005',ger:'SERVICIOS',nombre:'Mejoramiento parque principal',estado:'ejecucion',pct:82,presup:95000,fin:'2024-12-08',riesgo:'bajo',dias_sin_av:1,contratista:'Jardinería Cajamarca'},
      {id:'obra-006',ger:'SOCIAL',nombre:'Centro de salud Baños del Inca',estado:'licitacion',pct:0,presup:920000,fin:'2025-06-30',riesgo:'bajo',dias_sin_av:0,contratista:null},
    ],
    agenda:[
      {id:'ag-001',hora:'08:30',dur:'1h',titulo:'Reunión de staff semanal',lugar:'Sala de regidores',tipo:'interna',br:true,br_listo:true},
      {id:'ag-002',hora:'10:00',dur:'45min',titulo:'Visita supervisión obra Jr. Lima',lugar:'Jr. Lima cuadra 8',tipo:'campo',br:true,br_listo:true},
      {id:'ag-003',hora:'12:30',dur:'30min',titulo:'Audiencia — Comunidad San Sebastián',lugar:'Despacho',tipo:'audiencia',br:false,br_listo:false},
      {id:'ag-004',hora:'15:00',dur:'2h',titulo:'Sesión ordinaria Concejo Municipal',lugar:'Sala principal',tipo:'concejo',br:true,br_listo:true},
      {id:'ag-005',hora:'18:00',dur:'1h',titulo:'Firma de documentos pendientes',lugar:'Despacho',tipo:'admin',br:false,br_listo:false},
    ],
    documentos:[
      {id:'doc-001',titulo:'Resolución de Alcaldía N°421-2024',sub:'Modificación presupuestaria S/85,000',tipo:'resolucion',urgencia:'urgente',estado:'pendiente'},
      {id:'doc-002',titulo:'Convenio Marco — Universidad UNC',sub:'Pasantías y asistencia técnica · 2 años',tipo:'convenio',urgencia:'normal',estado:'pendiente'},
      {id:'doc-003',titulo:'Contrato servicio limpieza N°089',sub:'Renovación enero-diciembre 2025 · S/145,000',tipo:'contrato',urgencia:'normal',estado:'pendiente'},
    ],
    plazos:[
      {id:'pla-001',sistema:'MEF/SIAF',desc:'Devengado 4to trimestre',dias:18,resp:'PLANIF',niv:'critico'},
      {id:'pla-002',sistema:'Invierte.pe',desc:'Actualizar avance 3 proyectos',dias:11,resp:'INFRA',niv:'critico'},
      {id:'pla-003',sistema:'Contraloría',desc:'Subsanación hallazgos CGR 2024',dias:24,resp:'GM',niv:'alerta'},
      {id:'pla-004',sistema:'SEACE',desc:'Renovación contratos servicios',dias:35,resp:'SERVICIOS',niv:'info'},
    ],
    alertas:[
      {id:'alt-001',ico:'🚨',titulo:'Obra Jr. Lima paralizada · 26 días',desc:'Sin avance desde el 24 oct. S/480K en riesgo.',niv:'critico',area:'INFRA',leida:false,ts:Date.now()-3600000},
      {id:'alt-002',ico:'⏰',titulo:'Plazo MEF vence en 18 días',desc:'S/1.2M sin devengar en Planeamiento.',niv:'critico',area:'PLANIF',leida:false,ts:Date.now()-10800000},
      {id:'alt-003',ico:'⚠️',titulo:'5 compromisos vencidos sin respuesta',desc:'Rentas (2), Servicios (2), Planeamiento (1).',niv:'alerta',area:'GM',leida:false,ts:Date.now()-86400000},
      {id:'alt-004',ico:'📋',titulo:'3 documentos esperan tu firma',desc:'Resolución N°421, Convenio UNC, Contrato limpieza.',niv:'info',area:'Secretaría',leida:false,ts:Date.now()-28800000},
    ],
    presupuesto:{
      total:7830000,ejecutado:5298100,pct_global:67,
      por_area:[
        {cod:'INFRA',nombre:'Infraestructura y Obras',asig:4850000,ejec:3421000,pct:71},
        {cod:'SOCIAL',nombre:'Desarrollo Social',asig:1200000,ejec:940000,pct:78},
        {cod:'RENTAS',nombre:'Rentas y Tributación',asig:380000,ejec:155000,pct:41},
        {cod:'SERVICIOS',nombre:'Servicios Municipales',asig:920000,ejec:512000,pct:56},
        {cod:'SECRETARIA',nombre:'Secretaría General',asig:290000,ejec:198000,pct:68},
        {cod:'PLANIF',nombre:'Planeamiento y Presupuesto',asig:185000,ejec:72000,pct:39},
      ],
    },
    indicadores:{
      INFRA:[{n:'Metros pavimentados (ml)',v:2840,meta:4500,u:'ml'},{n:'Obras entregadas',v:11,meta:18,u:'obras'}],
      RENTAS:[{n:'Recaudación del mes (S/)',v:185420,meta:310000,u:'S/'},{n:'Contribuyentes al día',v:3840,meta:5200,u:'contrib.'}],
      SERVICIOS:[{n:'Toneladas/día recogidas',v:28,meta:35,u:'ton/día'},{n:'Cobertura limpieza (%)',v:78,meta:95,u:'%'}],
      SOCIAL:[{n:'Atenciones salud',v:1840,meta:2400,u:'atenc.'},{n:'Beneficiarios programas',v:3240,meta:3800,u:'benef.'}],
      SECRETARIA:[{n:'Expedientes resueltos',v:231,meta:284,u:'exp.'},{n:'Docs notificados',v:196,meta:220,u:'docs'}],
      PLANIF:[{n:'Ejecución presup. (%)',v:39,meta:75,u:'%'},{n:'Informes emitidos',v:9,meta:12,u:'inform.'}],
    },
    integraciones:[
      {sistema:'SIAF_GL',estado:'degradado',freshness:45,ultima_sync:Date.now()-18000000,error:'API MEF no disponible desde las 03:00'},
      {sistema:'INVIERTE_PE',estado:'activo',freshness:92,ultima_sync:Date.now()-7200000,error:null},
      {sistema:'SEACE',estado:'desconectado',freshness:0,ultima_sync:Date.now()-259200000,error:'Timeout después de 3 reintentos'},
    ],
  };

  /* ─────────────────────────────────────────────────────────────
     LOCAL ADAPTER  (Etapas 1-3 — localStorage)
  ───────────────────────────────────────────────────────────────*/
  const LA = {
    KEY: 'kausay_db_v2',
    load() {
      try { const r=localStorage.getItem(this.KEY); if(r) return JSON.parse(r); }
      catch(e) { console.warn('[LA] load error',e); }
      return JSON.parse(JSON.stringify(SEED));
    },
    save(db) {
      try { localStorage.setItem(this.KEY,JSON.stringify(db)); }
      catch(e) { try { localStorage.removeItem('kausay_cache_v2'); } catch(_){} }
    },
    reset() {
      localStorage.removeItem(this.KEY);
      localStorage.removeItem('kausay_wq_v2');
      return JSON.parse(JSON.stringify(SEED));
    },
  };

  /* ─────────────────────────────────────────────────────────────
     SUPABASE ADAPTER  (Etapa 4 — backend real)
     Queries alineados con supabase-setup.sql v2.
     Todas las funciones son async y retornan null en error
     (el caller decide si usa caché o LocalAdapter como fallback).
  ───────────────────────────────────────────────────────────────*/
  const SB = {
    _sb: null,
    _channels: {},   // canales Realtime activos por tabla

    init() {
      if (!window.supabase || CONFIG.SUPABASE_URL.startsWith('TU_')) return false;
      this._sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
        realtime: { params: { eventsPerSecond: 10 } },
        auth:     { persistSession: true, autoRefreshToken: true },
      });
      return true;
    },

    // ── MUNICIPALIDAD ──────────────────────────────────────────
    async getMuni() {
      const { data,error } = await this._sb.from('municipalidades')
        .select('*').single();
      if (error) { _sbError('getMuni',error); return null; }
      return _mapMuni(data);
    },
    async setMuni(updates) {
      const row = _unmapMuni(updates);
      const { error } = await this._sb.from('municipalidades')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', _getMuniId());
      if (error) { _sbError('setMuni',error); return false; }
      return true;
    },

    // ── GERENCIAS ──────────────────────────────────────────────
    async getGerencias() {
      const { data,error } = await this._sb.from('gerencias')
        .select('*').eq('municipalidad_id',_getMuniId()).order('orden');
      if (error) { _sbError('getGerencias',error); return null; }
      return data.map(_mapGerencia);
    },
    async updateGerencia(cod, updates) {
      const { error } = await this._sb.from('gerencias')
        .update({ jefe_nombre:updates.jefe, nombre:updates.nombre,
                  color:updates.color, activa:updates.activa,
                  updated_at:new Date().toISOString() })
        .eq('municipalidad_id',_getMuniId()).eq('cod',cod);
      if (error) { _sbError('updateGerencia',error); return false; }
      return true;
    },

    // ── INSTRUCCIONES ──────────────────────────────────────────
    async getInstrucciones(gerCod=null) {
      let q = this._sb.from('instrucciones')
        .select('*').eq('municipalidad_id',_getMuniId())
        .order('created_at',{ascending:false});
      // Filtro por gerencia si se especifica
      if (gerCod && gerCod !== 'all') {
        q = q.or(`receptor_ger_cod.eq.${gerCod},emisor_id.eq.${_getUID()}`);
      }
      const { data,error } = await q;
      if (error) { _sbError('getInstrucciones',error); return null; }
      return data.map(_mapInstruccion);
    },
    async addInstruccion(instr) {
      // Buscar UUID del receptor por gerencia_cod o rol
      const receptorId = await _resolverReceptorId(instr.para);
      const row = {
        municipalidad_id: _getMuniId(),
        emisor_id:        _getUID(),
        receptor_id:      receptorId || _getUID(),   // fallback: mismo usuario en demo
        emisor_rol:       _getRol(),
        receptor_rol:     instr.para === 'GM' ? 'gerente_municipal' : 'gerente_sectorial',
        receptor_ger_cod: instr.para !== 'GM' ? instr.para : null,
        tipo:             instr.tipo,
        contenido:        instr.contenido,
        prioridad:        instr.prioridad || 'normal',
        created_at:       new Date().toISOString(),
      };
      const { data,error } = await this._sb.from('instrucciones')
        .insert(row).select().single();
      if (error) { _sbError('addInstruccion',error); return null; }
      return _mapInstruccion(data);
    },
    async confirmarInstruccion(id) {
      const { data,error } = await this._sb.from('instrucciones')
        .update({ confirmada:true, leida_en:new Date().toISOString() })
        .eq('id',id).select().single();
      if (error) { _sbError('confirmarInstruccion',error); return null; }
      return _mapInstruccion(data);
    },
    async responderInstruccion(id, respuesta) {
      const { data,error } = await this._sb.from('instrucciones')
        .update({ respuesta, confirmada:true, respondida_en:new Date().toISOString() })
        .eq('id',id).select().single();
      if (error) { _sbError('responderInstruccion',error); return null; }
      return _mapInstruccion(data);
    },
    async getPendientesCount(gerCod) {
      const { count,error } = await this._sb.from('instrucciones')
        .select('*',{count:'exact',head:true})
        .eq('municipalidad_id',_getMuniId())
        .eq('receptor_ger_cod',gerCod)
        .eq('confirmada',false);
      if (error) return 0;
      return count || 0;
    },

    // ── COMPROMISOS ────────────────────────────────────────────
    async getCompromisos(gerCod=null) {
      let q = this._sb.from('compromisos')
        .select('*').eq('municipalidad_id',_getMuniId())
        .order('fecha_limite',{ascending:true});
      if (gerCod) {
        const ger = await _gerenciaIdByCod(gerCod);
        if (ger) q = q.eq('gerencia_id',ger);
      }
      const { data,error } = await q;
      if (error) { _sbError('getCompromisos',error); return null; }
      return data.map(_mapCompromiso);
    },
    async addCompromiso(comp) {
      const gerId = comp.resp ? await _gerenciaIdByCod(comp.resp) : null;
      const row = {
        municipalidad_id: _getMuniId(),
        gerencia_id:      gerId,
        descripcion:      comp.desc,
        origen:           comp.origen || 'otro',
        origen_ref:       comp.origen_ref,
        fecha_limite:     comp.fec,
        prioridad:        comp.prioridad || 'media',
        estado:           'pendiente',
      };
      const { data,error } = await this._sb.from('compromisos')
        .insert(row).select().single();
      if (error) { _sbError('addCompromiso',error); return null; }
      return _mapCompromiso(data);
    },
    async updateCompromiso(id, updates) {
      const row = {};
      if (updates.estado)    row.estado    = updates.estado;
      if (updates.evidencia) row.evidencia = updates.evidencia;
      row.updated_at = new Date().toISOString();
      const { data,error } = await this._sb.from('compromisos')
        .update(row).eq('id',id).select().single();
      if (error) { _sbError('updateCompromiso',error); return null; }
      return _mapCompromiso(data);
    },

    // ── OBRAS ──────────────────────────────────────────────────
    async getObras(gerCod=null) {
      let q = this._sb.from('obras')
        .select('*, gerencias(cod,nombre,color)')
        .eq('municipalidad_id',_getMuniId());
      if (gerCod) {
        const gerId = await _gerenciaIdByCod(gerCod);
        if (gerId) q = q.eq('gerencia_id',gerId);
      }
      const { data,error } = await q;
      if (error) { _sbError('getObras',error); return null; }
      return data.map(_mapObra);
    },
    async updateAvanceObra(id, pct, observacion='') {
      // 1. Insertar en historial avances_obra
      const { error:e1 } = await this._sb.from('avances_obra').insert({
        obra_id:          id,
        municipalidad_id: _getMuniId(),
        usuario_id:       _getUID(),
        porcentaje:       pct,
        observacion:      observacion || null,
      });
      if (e1) { _sbError('updateAvanceObra(insert)',e1); return null; }
      // 2. El trigger trg_avance_actualiza_obra actualiza obras automáticamente
      // 3. Leer el estado actualizado
      const { data,error:e2 } = await this._sb.from('obras')
        .select('*').eq('id',id).single();
      if (e2) { _sbError('updateAvanceObra(select)',e2); return null; }
      return _mapObra(data);
    },

    // ── AGENDA ─────────────────────────────────────────────────
    async getAgenda(fecha=null) {
      const hoy = fecha || new Date().toISOString().split('T')[0];
      const { data,error } = await this._sb.from('agenda_items')
        .select('*').eq('municipalidad_id',_getMuniId())
        .eq('fecha',hoy).order('hora');
      if (error) { _sbError('getAgenda',error); return null; }
      return data.map(_mapAgenda);
    },
    async addAgenda(item) {
      const row = {
        municipalidad_id: _getMuniId(),
        fecha:  new Date().toISOString().split('T')[0],
        hora:   item.hora,
        duracion_min: _parseDuracion(item.dur),
        titulo: item.titulo,
        lugar:  item.lugar,
        tipo:   item.tipo,
        requiere_briefing: item.br || false,
        briefing_listo:    item.br_listo || false,
      };
      const { data,error } = await this._sb.from('agenda_items')
        .insert(row).select().single();
      if (error) { _sbError('addAgenda',error); return null; }
      return _mapAgenda(data);
    },

    // ── DOCUMENTOS ─────────────────────────────────────────────
    async getDocumentos() {
      const { data,error } = await this._sb.from('documentos_firma')
        .select('*').eq('municipalidad_id',_getMuniId())
        .order('created_at',{ascending:false});
      if (error) { _sbError('getDocumentos',error); return null; }
      return data.map(_mapDocumento);
    },
    async addDocumento(doc) {
      const { data,error } = await this._sb.from('documentos_firma').insert({
        municipalidad_id: _getMuniId(),
        enviado_por_id:   _getUID(),
        titulo:           doc.titulo,
        descripcion:      doc.sub,
        tipo:             doc.tipo,
        urgencia:         doc.urgencia || 'normal',
        estado:           'pendiente',
      }).select().single();
      if (error) { _sbError('addDocumento',error); return null; }
      return _mapDocumento(data);
    },
    async updateDocumento(id, estado, motivo=null) {
      const { data,error } = await this._sb.from('documentos_firma')
        .update({ estado, motivo_devolucion:motivo, fecha_accion:new Date().toISOString() })
        .eq('id',id).select().single();
      if (error) { _sbError('updateDocumento',error); return null; }
      return _mapDocumento(data);
    },

    // ── ALERTAS ────────────────────────────────────────────────
    async getAlertas() {
      const { data,error } = await this._sb.from('alertas')
        .select('*, gerencias(cod)')
        .eq('municipalidad_id',_getMuniId())
        .order('created_at',{ascending:false});
      if (error) { _sbError('getAlertas',error); return null; }
      return data.map(_mapAlerta);
    },
    async addAlerta(al) {
      const gerId = al.area ? await _gerenciaIdByCod(al.area) : null;
      const { data,error } = await this._sb.from('alertas').insert({
        municipalidad_id: _getMuniId(),
        gerencia_id:      gerId,
        titulo:           al.titulo,
        descripcion:      al.desc,
        nivel:            al.niv,
      }).select().single();
      if (error) { _sbError('addAlerta',error); return null; }
      return _mapAlerta(data);
    },
    async marcarAlertaLeida(id) {
      const { error } = await this._sb.from('alertas')
        .update({ leida:true }).eq('id',id);
      if (error) { _sbError('marcarAlertaLeida',error); return false; }
      return true;
    },

    // ── PRESUPUESTO ────────────────────────────────────────────
    async getPresupuesto() {
      const { data,error } = await this._sb.from('presupuesto_view')
        .select('*, gerencias(cod,nombre)')
        .eq('municipalidad_id',_getMuniId())
        .eq('anio', new Date().getFullYear());
      if (error) { _sbError('getPresupuesto',error); return null; }
      return _mapPresupuesto(data);
    },

    // ── INDICADORES ────────────────────────────────────────────
    async getIndicadores(gerCod) {
      const gerId = await _gerenciaIdByCod(gerCod);
      if (!gerId) return [];
      const { data,error } = await this._sb.from('indicadores')
        .select('*').eq('gerencia_id',gerId).order('orden');
      if (error) { _sbError('getIndicadores',error); return null; }
      return data.map(r=>({n:r.nombre,v:r.valor_actual,meta:r.meta_anual,u:r.unidad}));
    },
    async updateIndicador(cod, idx, valor) {
      const gerId = await _gerenciaIdByCod(cod);
      if (!gerId) return false;
      // Buscar el indicador por gerencia e índice
      const { data:rows } = await this._sb.from('indicadores')
        .select('id').eq('gerencia_id',gerId).order('orden');
      if (!rows || !rows[idx]) return false;
      const { error } = await this._sb.from('indicadores')
        .update({ valor_actual:valor, updated_at:new Date().toISOString() })
        .eq('id',rows[idx].id);
      return !error;
    },

    // ── PLAZOS ─────────────────────────────────────────────────
    async getPlazos() {
      const { data,error } = await this._sb.from('plazos_normativos_view')
        .select('*, gerencias(cod)')
        .eq('municipalidad_id',_getMuniId())
        .eq('completado',false)
        .order('fecha_limite');
      if (error) { _sbError('getPlazos',error); return null; }
      return data.map(r=>({
        id:     r.id, sistema:r.sistema, desc:r.descripcion,
        dias:   r.dias_restantes, resp:r.responsable_cod||r.gerencias?.cod,
        niv:    r.estado_calculado==='critico'?'critico':r.estado_calculado==='alerta'?'alerta':'info',
      }));
    },

    // ── INTEGRACIONES ──────────────────────────────────────────
    async getIntegraciones() {
      const { data,error } = await this._sb.from('integraciones_sync_status')
        .select('*').eq('municipalidad_id',_getMuniId());
      if (error) { _sbError('getIntegraciones',error); return null; }
      return data.map(r=>({
        sistema:r.sistema, estado:r.estado,
        freshness:r.freshness_score,
        ultima_sync: r.ultima_sync ? new Date(r.ultima_sync).getTime() : 0,
        error:r.ultimo_error,
      }));
    },

    // ── REALTIME SUBSCRIPTIONS ─────────────────────────────────
    // ── RESUMEN EJECUTIVO / BADGES / GERENCIAS via RPC ──────────
    async getResumenEjecutivoRPC(rol) {
      const { data,error } = await this._sb.rpc('get_resumen_ejecutivo', { p_rol: rol||null });
      if (error) { _sbError('get_resumen_ejecutivo',error); return null; }
      return data;
    },
    async getBadgesRol() {
      const { data,error } = await this._sb.rpc('get_badges_rol');
      if (error) { _sbError('get_badges_rol',error); return null; }
      return data;
    },
    async getGerenciasResumenView() {
      const { data,error } = await this._sb.from('gerencias_resumen_view')
        .select('*').eq('municipalidad_id',_getMuniId()).order('orden');
      if (error) { _sbError('gerencias_resumen_view',error); return null; }
      return data;
    },
    async getResumenGerenciaRPC(cod) {
      const { data,error } = await this._sb.rpc('get_resumen_gerencia', { p_gerencia_cod: cod });
      if (error) { _sbError('get_resumen_gerencia',error); return null; }
      return data;
    },

    subscribe(tabla, filtro, callback) {
      if (!this._sb) return null;
      // Evitar canales duplicados
      const key = `${tabla}:${filtro}`;
      if (this._channels[key]) return this._channels[key];

      const channel = this._sb.channel(`rt-${tabla}-${_getMuniId()}`)
        .on('postgres_changes', {
          event:  '*',
          schema: 'public',
          table:  tabla,
          filter: filtro || `municipalidad_id=eq.${_getMuniId()}`,
        }, callback)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') console.log(`[RT] ✓ ${tabla} suscrito`);
          if (status === 'CHANNEL_ERROR') console.warn(`[RT] ✗ ${tabla} error`);
        });

      this._channels[key] = channel;
      return channel;
    },
    unsubscribe(tabla, filtro) {
      const key = `${tabla}:${filtro}`;
      if (this._channels[key]) {
        this._sb.removeChannel(this._channels[key]);
        delete this._channels[key];
      }
    },
    unsubscribeAll() {
      Object.values(this._channels).forEach(ch => this._sb?.removeChannel(ch));
      this._channels = {};
    },

    // ── RPC ────────────────────────────────────────────────────
    async rpc(fn, params) {
      const { data,error } = await this._sb.rpc(fn, params);
      if (error) { _sbError(`rpc:${fn}`,error); return null; }
      return data;
    },
  };

  /* ─────────────────────────────────────────────────────────────
     MAPPERS SQL → JS (alinean nombres de columna del schema)
  ───────────────────────────────────────────────────────────────*/
  function _mapMuni(r) {
    return {
      id:              r.id,
      nombre:          r.nombre,
      nombre_corto:    r.nombre_corto,
      tipo:            r.tipo,
      ubigeo:          r.ubigeo,
      departamento:    r.departamento,
      provincia:       r.provincia,
      distrito:        r.distrito,
      escudo_url:      r.escudo_url,
      color_primario:  r.color_primario,
      color_secundario:r.color_secundario,
      alcalde:         r.alcalde_nombre,
      secretaria:      r.secretaria_nombre,
      gm:              r.gm_nombre,
    };
  }
  function _unmapMuni(js) {
    const map = {
      nombre:          'nombre',
      nombre_corto:    'nombre_corto',
      tipo:            'tipo',
      ubigeo:          'ubigeo',
      departamento:    'departamento',
      provincia:       'provincia',
      distrito:        'distrito',
      escudo_url:      'escudo_url',
      color_primario:  'color_primario',
      color_secundario:'color_secundario',
      alcalde:         'alcalde_nombre',
      secretaria:      'secretaria_nombre',
      gm:              'gm_nombre',
    };
    const row = {};
    Object.entries(js).forEach(([k,v]) => { if(map[k]) row[map[k]]=v; });
    return row;
  }

  function _mapGerencia(r) {
    return {
      id:     r.id,
      cod:    r.cod,
      nombre: r.nombre,
      jefe:   r.jefe_nombre,
      color:  r.color,
      ejec:   r.ejec || 0,       // calculado por join a presupuesto en Etapa 4
      activa: r.activa,
    };
  }

  function _mapInstruccion(r) {
    return {
      id:            r.id,
      de:            r.emisor_rol === 'alcalde' ? 'alcalde' : r.emisor_id,
      para:          r.receptor_ger_cod || (r.receptor_rol==='gerente_municipal'?'GM':r.receptor_rol),
      paraLabel:     _rolLabel(r.receptor_rol, r.receptor_ger_cod),
      tipo:          r.tipo,
      contenido:     r.contenido,
      hora:          r.created_at ? new Date(r.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—',
      ts:            r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      confirmada:    r.confirmada,
      leida_en:      r.leida_en,
      respuesta:     r.respuesta || '',
      respondida_en: r.respondida_en,
      prioridad:     r.prioridad,
    };
  }

  function _mapCompromiso(r) {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const fec  = r.fecha_limite ? new Date(r.fecha_limite) : null;
    const ven  = fec && fec < hoy && r.estado !== 'cumplido';
    return {
      id:         r.id,
      desc:       r.descripcion,
      resp:       r.gerencias?.cod || r.gerencia_id,
      origen:     r.origen,
      origen_ref: r.origen_ref,
      fec:        r.fecha_limite,
      ven,
      estado:     ven && r.estado==='pendiente' ? 'vencido' : r.estado,
      prioridad:  r.prioridad,
    };
  }

  function _mapObra(r) {
    return {
      id:          r.id,
      ger:         r.gerencias?.cod || '',
      nombre:      r.nombre,
      estado:      r.estado,
      pct:         r.porcentaje_avance,
      presup:      r.presupuesto,
      fin:         r.fecha_fin_prevista,
      riesgo:      r.riesgo_nivel,
      dias_sin_av: r.dias_sin_avance,
      contratista: r.contratista,
    };
  }

  function _mapAgenda(r) {
    return {
      id:       r.id,
      hora:     r.hora ? r.hora.slice(0,5) : '—',
      dur:      r.duracion_min ? `${r.duracion_min}min` : '1h',
      titulo:   r.titulo,
      lugar:    r.lugar || '—',
      tipo:     r.tipo,
      br:       r.requiere_briefing,
      br_listo: r.briefing_listo,
    };
  }

  function _mapDocumento(r) {
    return {
      id:       r.id,
      titulo:   r.titulo,
      sub:      r.descripcion,
      tipo:     r.tipo,
      urgencia: r.urgencia,
      estado:   r.estado,
      motivo_devolucion: r.motivo_devolucion,
    };
  }

  function _mapAlerta(r) {
    const niv = r.nivel || r.niv;
    const ico = niv==='critico'?'🚨':niv==='alerta'?'⚠️':'📋';
    return {
      id:     r.id,
      ico,
      titulo: r.titulo,
      desc:   r.descripcion,
      niv:    niv,
      area:   r.gerencias?.cod || '',
      leida:  r.leida,
      ts:     r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    };
  }

  function _mapPresupuesto(rows) {
    const global = rows.find(r => !r.gerencia_id);
    const areas  = rows.filter(r => r.gerencia_id);
    return {
      total:      global?.asignado   || 0,
      ejecutado:  global?.ejecutado  || 0,
      pct_global: global?.pct_ejecucion || 0,
      por_area:   areas.map(r => ({
        cod:    r.gerencias?.cod || '',
        nombre: r.gerencias?.nombre || '',
        asig:   r.asignado,
        ejec:   r.ejecutado,
        pct:    r.pct_ejecucion || 0,
      })),
    };
  }

  /* ─────────────────────────────────────────────────────────────
     CACHE LAYER — invalidación por entidad con TTL
  ───────────────────────────────────────────────────────────────*/
  const Cache = {
    _store: {},
    get(key) {
      const e = this._store[key];
      if (!e) return null;
      const ttl = CONFIG.TTL[key.split(':')[0]] || 300_000;
      if (Date.now() - e.ts > ttl) { delete this._store[key]; return null; }
      return e.data;
    },
    set(key, data) { this._store[key] = { ts:Date.now(), data }; },
    del(key) { delete this._store[key]; },
    invalidate(...keys) { keys.forEach(k => Object.keys(this._store)
      .filter(sk=>sk.startsWith(k)).forEach(sk=>delete this._store[sk])); },
    clear() { this._store = {}; },
  };

  /* ─────────────────────────────────────────────────────────────
     WRITE QUEUE — operaciones offline con retry exponencial
  ───────────────────────────────────────────────────────────────*/
  const WQ = {
    KEY: 'kausay_wq_v2',
    _processing: false,
    load()  { try { return JSON.parse(localStorage.getItem(this.KEY)||'[]'); } catch(e){return[];} },
    save(q) { try { localStorage.setItem(this.KEY,JSON.stringify(q)); } catch(e){} },
    enqueue(op) {
      const q = this.load();
      q.push({ id:_uuid(), table:op.table, action:op.action, payload:op.payload,
                created_at:Date.now(), retries:0,
                max_retries:CONFIG.WQ_MAX_RETRIES, status:'pending' });
      this.save(q);
    },
    async flush() {
      if (this._processing || !navigator.onLine || !CONFIG.USE_SUPABASE) return;
      const pending = this.load().filter(e=>e.status==='pending');
      if (!pending.length) return;
      this._processing = true;
      for (const entry of pending) {
        try {
          let result;
          if      (entry.action==='insert') result = await SB._sb.from(entry.table).insert(entry.payload);
          else if (entry.action==='update') result = await SB._sb.from(entry.table).update(entry.payload).eq('id',entry.payload.id);
          else if (entry.action==='upsert') result = await SB._sb.from(entry.table).upsert(entry.payload);
          if (result?.error) throw result.error;
          this.save(this.load().filter(e=>e.id!==entry.id));
          Telemetry.track('wq_flushed',{table:entry.table});
        } catch(err) {
          const q  = this.load();
          const idx = q.findIndex(e=>e.id===entry.id);
          if (idx>=0) {
            q[idx].retries++;
            if (q[idx].retries >= q[idx].max_retries) {
              q[idx].status = 'conflict';
              EB.emit('wq:conflict',{table:entry.table,id:entry.id});
            }
            this.save(q);
          }
        }
      }
      this._processing = false;
    },
    pendingCount()  { return this.load().filter(e=>e.status==='pending').length; },
    conflictCount() { return this.load().filter(e=>e.status==='conflict').length; },
  };
  window.addEventListener('online', () => WQ.flush());

  /* ─────────────────────────────────────────────────────────────
     EVENT BUS — BroadcastChannel entre pestañas
  ───────────────────────────────────────────────────────────────*/
  const EB = {
    _l:{},
    on(ev,cb)  { (this._l[ev]=this._l[ev]||[]).push(cb); },
    off(ev,cb) { this._l[ev]=(this._l[ev]||[]).filter(f=>f!==cb); },
    emit(ev,data) {
      (this._l[ev]||[]).forEach(cb=>{try{cb(data);}catch(e){}});
      try { new BroadcastChannel('kausay').postMessage({ev,data}); } catch(e){}
    },
  };
  try {
    const bc = new BroadcastChannel('kausay');
    bc.onmessage = ({data:{ev,data}}) => EB.emit('remote:'+ev,data);
  } catch(e){}

  /* ─────────────────────────────────────────────────────────────
     AUDIT EMITTERS
  ───────────────────────────────────────────────────────────────*/
  const Audit = {
    emit(tipo,id,label,accion,before=null,after=null) {
      const ev = { id:_uuid(),municipalidad_id:_getMuniId(),usuario_id:_getUID(),
                   usuario_rol:_getRol(),entidad_tipo:tipo,entidad_id:id,
                   entidad_label:label,accion,before_state:before,after_state:after,
                   delta:_delta(before,after),device_type:_device(),
                   created_at:new Date().toISOString() };
      // Local buffer
      try {
        const b=JSON.parse(localStorage.getItem('kausay_audit')||'[]');
        b.push(ev); if(b.length>500) b.splice(0,b.length-500);
        localStorage.setItem('kausay_audit',JSON.stringify(b));
      } catch(e){}
      // Supabase via RPC (triggers también lo hacen, pero esto cubre acciones de auth)
      if (CONFIG.USE_SUPABASE && SB._sb) {
        SB.rpc('registrar_evento',{
          p_entidad_tipo:tipo, p_entidad_id:String(id||''),
          p_entidad_label:label||'', p_accion:accion,
          p_before_state:before, p_after_state:after,
        }).catch(()=>{});
      }
      return ev.id;
    },
    onCreate: (t,id,l,d)   => Audit.emit(t,id,l,'create', null,d),
    onUpdate: (t,id,l,b,a) => Audit.emit(t,id,l,'update', b,a),
    onConfirm:(t,id,l,d)   => Audit.emit(t,id,l,'confirm',null,d),
    onRespond:(t,id,l,d)   => Audit.emit(t,id,l,'respond',null,d),
    onApprove:(t,id,l,d)   => Audit.emit(t,id,l,'approve',null,d),
    onExport: (t,m,n)      => Audit.emit('exportacion',t,m,'export',null,{modulo:m,registros:n}),
    onLogin:  ()           => Audit.emit('auth',_getUID(),_getRol(),'login'),
    onLogout: ()           => Audit.emit('auth',_getUID(),_getRol(),'logout'),
  };

  /* ─────────────────────────────────────────────────────────────
     TELEMETRY HOOKS
  ───────────────────────────────────────────────────────────────*/
  const Telemetry = {
    _t0:Date.now(), _fa:false,
    track(ev,meta={}) {
      const r={ev,rol:_getRol(),ts:Date.now(),dev:_device(),...meta};
      try {
        const b=JSON.parse(localStorage.getItem('kausay_telemetry')||'[]');
        b.push(r); if(b.length>200) b.splice(0,b.length-200);
        localStorage.setItem('kausay_telemetry',JSON.stringify(b));
      } catch(e){}
      if (CONFIG.USE_SUPABASE && SB._sb) {
        SB._sb.from('product_telemetry').insert({
          municipalidad_id:_getMuniId(), usuario_id:_getUID(),
          rol:_getRol(), evento:ev, metadata:meta, device_type:_device(),
        }).catch(()=>{});
      }
    },
    appOpen()                 { this.track('app_open'); },
    firstAction()             { if(!this._fa){this.track('primera_accion',{ttfa:Date.now()-this._t0});this._fa=true;} },
    instruccionEnviada(tipo)  { this.track('instruccion_enviada',{tipo}); this.firstAction(); },
    instruccionConfirmada(h)  { this.track('instruccion_confirmada',{horas:h}); },
    obraActualizada()         { this.track('obra_actualizada'); this.firstAction(); },
    briefingAbierto()         { this.track('briefing_abierto'); },
    alertaResuelta()          { this.track('alerta_resuelta'); },
    exportacionRealizada(m)   { this.track('exportacion_realizada',{modulo:m}); },
  };

  /* ─────────────────────────────────────────────────────────────
     HELPERS INTERNOS
  ───────────────────────────────────────────────────────────────*/
  function _uuid()    { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);}); }
  function _ts()      { return new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}); }
  function _getMuniId() {
    if (CONFIG.USE_SUPABASE) return sessionStorage.getItem('kausay_muni_id') || '';
    try { return LA.load().municipalidad?.id||'local'; } catch(e){return'local';}
  }
  function _getUID()  { return sessionStorage.getItem('kausay_uid')||'demo'; }
  function _getRol()  { return sessionStorage.getItem('kausay_demo_rol')||'alcalde'; }
  function _device()  { return /Mobi|Android|iPhone/i.test(navigator.userAgent)?'mobile':/Tablet|iPad/i.test(navigator.userAgent)?'tablet':'desktop'; }
  function _delta(b,a){ if(!b||!a)return null; const d={}; Object.keys(a).forEach(k=>{if(JSON.stringify(b[k])!==JSON.stringify(a[k]))d[k]={before:b[k],after:a[k]};}); return Object.keys(d).length?d:null; }
  function _sbError(fn,err) { console.error(`[SB:${fn}]`,err?.message||err); }
  function _rolLabel(rol,gerCod) {
    if (gerCod) return gerCod;
    const m={alcalde:'Alcalde',secretaria:'Secretaria',gerente_municipal:'Gerente Municipal',gerente_sectorial:'Gerente Sectorial'};
    return m[rol]||rol;
  }
  function _parseDuracion(s) {
    if (!s) return 60;
    const m=parseInt(s); if(!isNaN(m))return m;
    if(s.includes('h'))return parseInt(s)*60;
    return 60;
  }

  // Resolver UUID de receptor a partir de gerencia_cod o rol
  async function _resolverReceptorId(para) {
    if (!CONFIG.USE_SUPABASE || !SB._sb) return null;
    if (para === 'GM') {
      const {data} = await SB._sb.from('usuarios').select('id')
        .eq('municipalidad_id',_getMuniId()).eq('rol','gerente_municipal').single();
      return data?.id || null;
    }
    const {data} = await SB._sb.from('usuarios').select('id')
      .eq('municipalidad_id',_getMuniId()).eq('gerencia_cod',para).single();
    return data?.id || null;
  }

  // Cache de gerencia_id por cod (evitar queries repetidas)
  const _gerCache = {};
  async function _gerenciaIdByCod(cod) {
    if (!CONFIG.USE_SUPABASE || !SB._sb) return null;
    if (_gerCache[cod]) return _gerCache[cod];
    const {data} = await SB._sb.from('gerencias').select('id')
      .eq('municipalidad_id',_getMuniId()).eq('cod',cod).single();
    if (data?.id) _gerCache[cod] = data.id;
    return data?.id || null;
  }

  /* ─────────────────────────────────────────────────────────────
     ADAPTER ROUTER — decide si usa SB o LA + fallback
     Patrón: intentar SB primero, fallback a LA si falla,
     guardar en WQ para sync posterior.
  ───────────────────────────────────────────────────────────────*/
  async function _sbOrLocal(sbFn, localFn, cacheKey=null) {
    if (!CONFIG.USE_SUPABASE) return localFn();
    // Intentar cache primero
    if (cacheKey) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
    }
    try {
      const result = await sbFn();
      if (result !== null) {
        if (cacheKey) Cache.set(cacheKey, result);
        return result;
      }
    } catch(e) { console.warn('[KausayDB] SB error, using local fallback',e); }
    // Fallback a LocalAdapter
    return localFn();
  }

  /* ─────────────────────────────────────────────────────────────
     API PÚBLICA — idéntica a v2, ahora async-aware
     Los dashboards que usan .then() o await siguen funcionando.
     Los que no usan await reciben el valor local inmediatamente.
  ───────────────────────────────────────────────────────────────*/

  // ── MUNICIPALIDAD ──────────────────────────────────────────
  function getMuni() {
    if (!CONFIG.USE_SUPABASE) return LA.load().municipalidad;
    const cached = Cache.get('municipalidad');
    if (cached) return cached;
    // Retorna el local inmediatamente y actualiza en background
    const local = LA.load().municipalidad;
    SB.getMuni().then(r => { if(r){Cache.set('municipalidad',r);EB.emit('muni:updated',r);} }).catch(()=>{});
    return local;
  }
  async function setMuni(data) {
    const db=LA.load(); const before={...db.municipalidad};
    Object.assign(db.municipalidad,data); LA.save(db);
    Cache.invalidate('municipalidad');
    Audit.onUpdate('configuracion',db.municipalidad.id,'Municipalidad',before,db.municipalidad);
    EB.emit('muni:updated',db.municipalidad);
    if (CONFIG.USE_SUPABASE) await SB.setMuni(data);
  }

  // ── GERENCIAS ──────────────────────────────────────────────
  function getGerencias() {
    if (!CONFIG.USE_SUPABASE) return LA.load().gerencias;
    const cached = Cache.get('gerencias');
    if (cached) return cached;
    const local = LA.load().gerencias;
    SB.getGerencias().then(r=>{if(r){Cache.set('gerencias',r);}}).catch(()=>{});
    return local;
  }
  function getGerencia(cod) { return getGerencias().find(g=>g.cod===cod); }
  async function updateGerencia(cod,data) {
    const db=LA.load(); const idx=db.gerencias.findIndex(g=>g.cod===cod); if(idx<0)return;
    const before={...db.gerencias[idx]}; Object.assign(db.gerencias[idx],data); LA.save(db);
    Cache.invalidate('gerencias');
    Audit.onUpdate('gerencia',db.gerencias[idx].id,db.gerencias[idx].nombre,before,db.gerencias[idx]);
    EB.emit('gerencia:updated',{cod,data});
    if (CONFIG.USE_SUPABASE) { const ok=await SB.updateGerencia(cod,data); if(!ok) WQ.enqueue({table:'gerencias',action:'update',payload:{cod,...data}}); }
  }

  // ── INSTRUCCIONES ──────────────────────────────────────────
  function getInstrucciones(para=null) {
    if (!CONFIG.USE_SUPABASE) {
      const db=LA.load();
      return para ? db.instrucciones.filter(i=>i.para===para||i.de===para) : db.instrucciones;
    }
    const ck=`instrucciones:${para||'all'}`;
    const cached=Cache.get(ck); if(cached) return cached;
    const local=LA.load().instrucciones.filter(i=>!para||(i.para===para||i.de===para));
    SB.getInstrucciones(para).then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  async function addInstruccion(instr) {
    const db=LA.load();
    const nueva={id:'ins-'+Date.now(),de:'alcalde',hora:_ts(),ts:Date.now(),confirmada:false,respuesta:'',...instr};
    db.instrucciones.unshift(nueva); LA.save(db);
    Cache.invalidate('instrucciones');
    Audit.onCreate('instruccion',nueva.id,`[${nueva.tipo}] → ${nueva.paraLabel}`,nueva);
    Telemetry.instruccionEnviada(nueva.tipo);
    EB.emit('instruccion:nueva',nueva);
    if (CONFIG.USE_SUPABASE) {
      const sb=await SB.addInstruccion(instr);
      if (!sb) WQ.enqueue({table:'instrucciones',action:'insert',payload:{...instr,emisor_id:_getUID()}});
    }
    return nueva;
  }
  async function confirmarInstruccion(id) {
    const db=LA.load(); const ins=db.instrucciones.find(i=>i.id===id); if(!ins)return;
    const before={...ins}; ins.confirmada=true; ins.leida_en=new Date().toISOString(); LA.save(db);
    Cache.invalidate('instrucciones');
    Audit.onConfirm('instruccion',id,ins.contenido?.slice(0,50),ins);
    const horas=Math.round((Date.now()-ins.ts)/360000)/10;
    Telemetry.instruccionConfirmada(horas);
    EB.emit('instruccion:confirmada',{id});
    if (CONFIG.USE_SUPABASE) { const ok=await SB.confirmarInstruccion(id); if(!ok) WQ.enqueue({table:'instrucciones',action:'update',payload:{id,confirmada:true}}); }
    return ins;
  }
  async function responderInstruccion(id,respuesta) {
    const db=LA.load(); const ins=db.instrucciones.find(i=>i.id===id); if(!ins)return;
    ins.respuesta=respuesta; ins.confirmada=true; ins.respondida_en=new Date().toISOString(); LA.save(db);
    Cache.invalidate('instrucciones');
    Audit.onRespond('instruccion',id,ins.contenido?.slice(0,50),{respuesta});
    EB.emit('instruccion:respondida',{id,respuesta});
    if (CONFIG.USE_SUPABASE) { const ok=await SB.responderInstruccion(id,respuesta); if(!ok) WQ.enqueue({table:'instrucciones',action:'update',payload:{id,respuesta,confirmada:true}}); }
    return ins;
  }
  function getPendientesCount(para) { return LA.load().instrucciones.filter(i=>i.para===para&&!i.confirmada).length; }

  // ── COMPROMISOS ────────────────────────────────────────────
  function getCompromisos(resp=null) {
    if (!CONFIG.USE_SUPABASE) { const db=LA.load(); return resp?db.compromisos.filter(c=>c.resp===resp):db.compromisos; }
    const ck=`compromisos:${resp||'all'}`; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().compromisos.filter(c=>!resp||c.resp===resp);
    SB.getCompromisos(resp).then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  async function addCompromiso(comp) {
    const db=LA.load(); const n={id:'com-'+Date.now(),estado:'pendiente',...comp};
    db.compromisos.unshift(n); LA.save(db);
    Cache.invalidate('compromisos');
    Audit.onCreate('compromiso',n.id,n.desc,n); Telemetry.firstAction();
    EB.emit('compromiso:nuevo',n);
    if (CONFIG.USE_SUPABASE) { const sb=await SB.addCompromiso(comp); if(!sb) WQ.enqueue({table:'compromisos',action:'insert',payload:comp}); }
    return n;
  }
  async function updateCompromiso(id,data) {
    const db=LA.load(); const c=db.compromisos.find(x=>x.id===id); if(!c)return;
    const before={...c}; Object.assign(c,data); LA.save(db);
    Cache.invalidate('compromisos');
    Audit.onUpdate('compromiso',id,c.desc,before,c);
    EB.emit('compromiso:updated',{id,data});
    if (CONFIG.USE_SUPABASE) { const ok=await SB.updateCompromiso(id,data); if(!ok) WQ.enqueue({table:'compromisos',action:'update',payload:{id,...data}}); }
    return c;
  }

  // ── OBRAS ──────────────────────────────────────────────────
  function getObras(ger=null) {
    if (!CONFIG.USE_SUPABASE) { const db=LA.load(); return ger?db.obras.filter(o=>o.ger===ger):db.obras; }
    const ck=`obras:${ger||'all'}`; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().obras.filter(o=>!ger||o.ger===ger);
    SB.getObras(ger).then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  function calcRiesgoObra(o){let s=0;if(o.dias_sin_av>15)s+=40;else if(o.dias_sin_av>7)s+=20;else if(o.dias_sin_av>3)s+=10;if(o.pct<30&&o.estado==='ejecucion')s+=30;else if(o.pct<50)s+=15;if(o.estado==='paralizada')s+=30;if(s>=60)return'critico';if(s>=35)return'alto';if(s>=15)return'medio';return'bajo';}
  async function updateAvanceObra(id,pct) {
    const db=LA.load(); const o=db.obras.find(x=>x.id===id); if(!o)return;
    const before={pct:o.pct,dias_sin_av:o.dias_sin_av};
    o.pct=pct; o.dias_sin_av=0; o.ultimo_avance=new Date().toISOString(); o.riesgo=calcRiesgoObra(o); LA.save(db);
    Cache.invalidate('obras');
    Audit.onUpdate('obra',id,o.nombre,before,{pct,riesgo:o.riesgo});
    Telemetry.obraActualizada();
    EB.emit('obra:avance',{id,pct,riesgo:o.riesgo});
    if (CONFIG.USE_SUPABASE) {
      const obs = ''; // observación se pasa desde el dashboard si existe
      const sb=await SB.updateAvanceObra(id,pct,obs);
      if (!sb) WQ.enqueue({table:'avances_obra',action:'insert',payload:{obra_id:id,porcentaje:pct,municipalidad_id:_getMuniId(),usuario_id:_getUID()}});
    }
    return o;
  }

  // ── AGENDA ─────────────────────────────────────────────────
  function getAgenda() {
    if(!CONFIG.USE_SUPABASE) return LA.load().agenda;
    const ck='agenda'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().agenda;
    SB.getAgenda().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  async function addAgenda(item) {
    const db=LA.load(); const n={id:'ag-'+Date.now(),br:false,br_listo:false,...item};
    db.agenda.push(n); db.agenda.sort((a,b)=>a.hora.localeCompare(b.hora)); LA.save(db);
    Cache.invalidate('agenda');
    Audit.onCreate('agenda_item',n.id,n.titulo,n); EB.emit('agenda:nueva',n);
    if (CONFIG.USE_SUPABASE) { const sb=await SB.addAgenda(item); if(!sb) WQ.enqueue({table:'agenda_items',action:'insert',payload:item}); }
    return n;
  }

  // ── DOCUMENTOS ─────────────────────────────────────────────
  function getDocumentos() {
    if(!CONFIG.USE_SUPABASE) return LA.load().documentos;
    const ck='documentos'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().documentos;
    SB.getDocumentos().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  async function addDocumento(doc) {
    const db=LA.load(); const n={id:'doc-'+Date.now(),estado:'pendiente',...doc};
    db.documentos.unshift(n); LA.save(db);
    Cache.invalidate('documentos');
    Audit.onCreate('documento_firma',n.id,n.titulo,n); EB.emit('documento:nuevo',n);
    if (CONFIG.USE_SUPABASE) { const sb=await SB.addDocumento(doc); if(!sb) WQ.enqueue({table:'documentos_firma',action:'insert',payload:doc}); }
    return n;
  }
  async function updateDocumento(id,estado,motivo=null) {
    const db=LA.load(); const d=db.documentos.find(x=>x.id===id); if(!d)return;
    const before={estado:d.estado}; d.estado=estado; if(motivo)d.motivo_devolucion=motivo;
    d.fecha_accion=new Date().toISOString(); LA.save(db);
    Cache.invalidate('documentos');
    Audit.onUpdate('documento_firma',id,d.titulo,before,{estado});
    if(estado==='aprobado') Audit.onApprove('documento_firma',id,d.titulo,d);
    EB.emit('documento:updated',{id,estado});
    if (CONFIG.USE_SUPABASE) { const ok=await SB.updateDocumento(id,estado,motivo); if(!ok) WQ.enqueue({table:'documentos_firma',action:'update',payload:{id,estado,motivo_devolucion:motivo}}); }
    return d;
  }

  // ── ALERTAS ────────────────────────────────────────────────
  function getAlertas() {
    if(!CONFIG.USE_SUPABASE) return LA.load().alertas;
    const ck='alertas'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().alertas;
    SB.getAlertas().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  function getAlertasActivas() { return getAlertas().filter(a=>!a.leida); }
  async function addAlerta(al) {
    const db=LA.load(); const n={id:'alt-'+Date.now(),leida:false,ts:Date.now(),...al};
    db.alertas.unshift(n); LA.save(db);
    Cache.invalidate('alertas');
    EB.emit('alerta:nueva',n);
    if (CONFIG.USE_SUPABASE) { const sb=await SB.addAlerta(al); if(!sb) WQ.enqueue({table:'alertas',action:'insert',payload:al}); }
    return n;
  }
  async function marcarAlertaLeida(id) {
    const db=LA.load(); const a=db.alertas.find(x=>x.id===id);
    if(a){a.leida=true;LA.save(db);Cache.invalidate('alertas');Telemetry.alertaResuelta();EB.emit('alerta:leida',{id});}
    if (CONFIG.USE_SUPABASE) await SB.marcarAlertaLeida(id);
  }

  // ── PRESUPUESTO ────────────────────────────────────────────
  function getPresupuesto() {
    if(!CONFIG.USE_SUPABASE) return LA.load().presupuesto;
    const ck='presupuesto'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().presupuesto;
    SB.getPresupuesto().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  function getPresupuestoArea(cod) { return getPresupuesto().por_area.find(p=>p.cod===cod); }

  // ── PLAZOS ─────────────────────────────────────────────────
  function getPlazos() {
    if(!CONFIG.USE_SUPABASE) return LA.load().plazos;
    const ck='plazos'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().plazos;
    SB.getPlazos().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  function getCriticos() { return getPlazos().filter(p=>p.niv==='critico'); }

  // ── INDICADORES ────────────────────────────────────────────
  function getIndicadores(cod) {
    if(!CONFIG.USE_SUPABASE) return(LA.load().indicadores||{})[cod]||[];
    const ck=`indicadores:${cod}`; const cached=Cache.get(ck); if(cached)return cached;
    const local=(LA.load().indicadores||{})[cod]||[];
    SB.getIndicadores(cod).then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }
  async function updateIndicador(cod,idx,valor) {
    const db=LA.load(); if(!db.indicadores[cod]||!db.indicadores[cod][idx])return;
    const before={v:db.indicadores[cod][idx].v}; db.indicadores[cod][idx].v=valor; LA.save(db);
    Cache.invalidate(`indicadores:${cod}`);
    Audit.onUpdate('indicador',`${cod}_${idx}`,db.indicadores[cod][idx].n,before,{v:valor});
    EB.emit('indicador:updated',{cod,idx,valor});
    if (CONFIG.USE_SUPABASE) await SB.updateIndicador(cod,idx,valor);
  }

  // ── INTEGRACIONES ──────────────────────────────────────────
  function getIntegraciones() {
    if(!CONFIG.USE_SUPABASE) return LA.load().integraciones||[];
    const ck='integraciones'; const cached=Cache.get(ck); if(cached)return cached;
    const local=LA.load().integraciones||[];
    SB.getIntegraciones().then(r=>{if(r)Cache.set(ck,r);}).catch(()=>{});
    return local;
  }

  // ── BADGES ASYNC ──────────────────────────────────────────
  // Devuelve badges desde RPC (Supabase) o calcula local (demo)
  async function getBadgesAsync() {
    if (CONFIG.USE_SUPABASE && SB._sb) {
      const data = await SB.getBadgesRol();
      if (data) return data;
    }
    // Fallback: calcular localmente
    const r = getResumenEjecutivo();
    return {
      alertas:         (r.alertas_criticas + r.alertas_alerta),
      instrucciones:   r.instr_sin_leer,
      firmas:          r.docs_pendientes,
      compromisos_ven: r.compromisos_ven,
      obras_criticas:  r.obras_criticas,
      plazos_crit:     r.plazos_criticos,
      wq_conflicts:    WQ.conflictCount(),
    };
  }

  // ── GERENCIAS RESUMEN (view unificada) ─────────────────────
  function getGerenciasResumen() {
    if (!CONFIG.USE_SUPABASE) return _computeGerenciasResumenLocal();
    const ck='gerencias_resumen'; const cached=Cache.get(ck); if(cached)return cached;
    const local=_computeGerenciasResumenLocal();
    SB.getGerenciasResumenView().then(r=>{if(r)Cache.set(ck,r);EB.emit('gerencias:resumen',r);}).catch(()=>{});
    return local;
  }

  function _computeGerenciasResumenLocal() {
    return LA.load().gerencias.map(g => {
      const pres = getPresupuestoArea(g.cod) || {};
      const obras = getObras(g.cod);
      const comps = getCompromisos(g.cod);
      const kpis  = getIndicadores(g.cod);
      const kp    = kpis[0];
      const pct   = pres.pct || g.ejec || 0;
      return {
        ...g,
        pct_ejecucion:          pct,
        total_asignado:         pres.asig || 0,
        total_ejecutado:        pres.ejec || 0,
        obras_criticas:         obras.filter(o=>o.riesgo==='critico').length,
        obras_en_riesgo:        obras.filter(o=>['critico','alto'].includes(o.riesgo)).length,
        compromisos_pendientes: comps.filter(c=>c.estado==='pendiente').length,
        compromisos_vencidos:   comps.filter(c=>c.ven||c.estado==='vencido').length,
        kpi_nombre:  kp?.n, kpi_valor: kp?.v, kpi_meta: kp?.meta, kpi_pct: kp?Math.round(kp.v/kp.meta*100):0,
        estado_semaforo: pct<40?'critico':pct<65?'alerta':'normal',
        riesgo_resumen:  obras.some(o=>o.riesgo==='critico')?'Obra crítica':comps.some(c=>c.ven)?'Compromisos vencidos':pct<50?'Ejecución baja':'Al día',
      };
    });
  }

  async function getResumenGerencia(gerCod) {
    if (CONFIG.USE_SUPABASE && SB._sb) {
      const data = await SB.getResumenGerenciaRPC(gerCod);
      if (data && Object.keys(data).length) return data;
    }
    // Fallback local
    const local = _computeGerenciasResumenLocal().find(g=>g.cod===gerCod);
    const instrs = getInstrucciones(gerCod).filter(i=>!i.confirmada&&i.de==='alcalde');
    const obrasS = getObras(gerCod).filter(o=>o.estado!=='terminada'&&o.dias_sin_av>=3);
    return { ...local, instrucciones_sin_leer:instrs.length, avances_pendientes:obrasS.length };
  }

  // ── RESUMEN EJECUTIVO ──────────────────────────────────────
  function getResumenEjecutivo() {
    const db=LA.load();
    // En modo Supabase los datos ya están en LA por el load inicial async
    const alertas_criticas=getAlertasActivas().filter(a=>a.niv==='critico').length;
    const alertas_alerta  =getAlertasActivas().filter(a=>a.niv==='alerta').length;
    const obras           =getObras();
    const compromisos     =getCompromisos();
    const obras_criticas  =obras.filter(o=>o.riesgo==='critico').length;
    const obras_en_riesgo =obras.filter(o=>['critico','alto'].includes(o.riesgo)).length;
    const compromisos_ven =compromisos.filter(c=>c.ven||c.estado==='vencido').length;
    const docs_pendientes =getDocumentos().filter(d=>d.estado==='pendiente').length;
    const instr_sin_leer  =getInstrucciones().filter(i=>!i.confirmada).length;
    const plazos_criticos =getCriticos().length;
    const dias_mef        =getPlazos().find(p=>p.id==='pla-001'||p.sistema==='MEF/SIAF')?.dias||0;
    const pres            =getPresupuesto();
    const estado=alertas_criticas>=2?'critico':alertas_criticas>=1||alertas_alerta>=3?'alerta':'normal';
    return{alertas_criticas,alertas_alerta,obras_criticas,obras_en_riesgo,compromisos_ven,
           docs_pendientes,instr_sin_leer,plazos_criticos,dias_mef,
           ejec_global:pres.pct_global||0,agenda_hoy:getAgenda().length,estado};
  }

  async function getResumenEjecutivoAsync() {
    if (CONFIG.USE_SUPABASE && SB._sb) {
      const data = await SB.getResumenEjecutivoRPC(_getRol());
      if (data) {
        // Actualizar LocalAdapter con datos frescos del servidor
        const db = LA.load();
        // Merge decisions back into local state for sync getDecisionesDelDia()
        db._resumen_cache = data;
        LA.save(db);
        EB.emit('resumen:updated', data);
        return data;
      }
    }
    return getResumenEjecutivo();
  }

  function getDecisionesDelDia() {
    const ds=[];
    getObras().filter(o=>o.riesgo==='critico').forEach(o=>ds.push({id:'dec-obra-'+o.id,tipo:'obra_critica',ico:'🚨',ttl:o.nombre+' — '+(o.estado==='paralizada'?`paralizada ${o.dias_sin_av}d`:'riesgo crítico'),desc:'Decidir: continuar, resolver contrato o intervenir directamente.',tag:'Urgente hoy',color:'#8B1A1A',accion:'Ver obra',ref:o.id}));
    getPlazos().filter(p=>p.niv==='critico').forEach(p=>ds.push({id:'dec-plazo-'+p.id,tipo:'plazo_critico',ico:'⏰',ttl:`${p.sistema} vence en ${p.dias} días`,desc:p.desc+' — exigir plan al responsable.',tag:`${p.dias}d restantes`,color:'#9E6A06',accion:'Ver semáforo',ref:p.id}));
    const conc=getAgenda().find(a=>a.tipo==='concejo');
    if(conc)ds.push({id:'dec-concejo',tipo:'concejo',ico:'🏛',ttl:`Sesión de concejo ${conc.hora}`,desc:conc.br_listo?'✓ Briefing IA listo':'⚠ Briefing pendiente',tag:conc.br_listo?'Preparado':'Pendiente',color:'#1A4A7A',accion:conc.br_listo?'Ver briefing':'Generar briefing',ref:conc.id});
    const venCrit=getCompromisos().filter(c=>c.ven&&c.prioridad==='alta');
    if(venCrit.length)ds.push({id:'dec-compromisos',tipo:'compromisos_vencidos',ico:'🤝',ttl:`${venCrit.length} compromisos de alta prioridad vencidos`,desc:'Sin respuesta de los responsables.',tag:'Sin respuesta',color:'#8B1A1A',accion:'Ver compromisos',ref:null});
    const docUrg=getDocumentos().filter(d=>d.urgencia==='urgente'&&d.estado==='pendiente');
    if(docUrg.length)ds.push({id:'dec-docs',tipo:'firma_urgente',ico:'✍️',ttl:`${docUrg.length} documento${docUrg.length>1?'s urgentes':' urgente'} para tu firma`,desc:docUrg.map(d=>d.titulo).join(' · '),tag:'Firma hoy',color:'#9E6A06',accion:'Ver documentos',ref:null});
    return ds.slice(0,5);
  }

  // ── REALTIME SUBSCRIPTIONS ─────────────────────────────────
  // Patrón uniforme: subscribeRealtime(tabla, callback)
  // El callback recibe { eventType, new:row, old:row }
  // Los dashboards escuchan y re-emiten al EventBus propio.
  function subscribeRealtime(tabla, callback) {
    if (!CONFIG.USE_SUPABASE || !SB._sb) return null;
    const filtro = `municipalidad_id=eq.${_getMuniId()}`;
    return SB.subscribe(tabla, filtro, (payload) => {
      // Invalidar caché de la tabla afectada
      Cache.invalidate(tabla.replace('_',' ').split(' ')[0]);
      callback(payload);
    });
  }

  function unsubscribeRealtime(tabla) {
    if (!CONFIG.USE_SUPABASE) return;
    SB.unsubscribe(tabla, `municipalidad_id=eq.${_getMuniId()}`);
  }

  // ── CARGA INICIAL ASYNC (Etapa 4) ─────────────────────────
  // Llama a todas las entidades en paralelo y actualiza el LocalAdapter
  // para que las llamadas síncronas posteriores tengan datos frescos.
  async function loadInitialData() {
    if (!CONFIG.USE_SUPABASE || !SB._sb) return;
    try {
      const [muni,gers,instrs,comps,obras_,agenda_,docs,alertas_,pres,integ] = await Promise.allSettled([
        SB.getMuni(), SB.getGerencias(), SB.getInstrucciones(),
        SB.getCompromisos(), SB.getObras(), SB.getAgenda(),
        SB.getDocumentos(), SB.getAlertas(), SB.getPresupuesto(), SB.getIntegraciones(),
      ]);
      const db = LA.load();
      if (muni.value)     { db.municipalidad  = muni.value;   Cache.set('municipalidad',muni.value); }
      if (gers.value)     { db.gerencias       = gers.value;   Cache.set('gerencias',gers.value); }
      if (instrs.value)   { db.instrucciones   = instrs.value; }
      if (comps.value)    { db.compromisos     = comps.value;  }
      if (obras_.value)   { db.obras           = obras_.value; }
      if (agenda_.value)  { db.agenda          = agenda_.value;}
      if (docs.value)     { db.documentos      = docs.value;   }
      if (alertas_.value) { db.alertas         = alertas_.value;}
      if (pres.value)     { db.presupuesto     = pres.value;   }
      if (integ.value)    { db.integraciones   = integ.value;  }
      LA.save(db);
      EB.emit('data:loaded', { source:'supabase' });
    } catch(e) {
      console.warn('[KausayDB] loadInitialData partial error',e);
      EB.emit('data:loaded', { source:'local_fallback' });
    }
  }

  // ── UTILIDADES ─────────────────────────────────────────────
  const fmt=(n)=>{if(n==null)return'—';if(n>=1000000)return'S/'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'S/'+(n/1000).toFixed(0)+'K';return'S/'+n;};
  const pctColor=(p)=>p>=70?'#1A7A45':p>=50?'#C8880A':'#B02020';
  const pctBg=(p)=>p>=70?'#EEF8F3':p>=50?'#FDF8EE':'#FAF0F0';
  const pctLabel=(p)=>p>=70?'Normal':p>=50?'En riesgo':'Crítico';
  const riesgoColor=(r)=>({critico:'#B02020',alto:'#C8880A',medio:'#C8880A',bajo:'#1A7A45'}[r]||'#8A90A0');
  const relativeTime=(ts)=>{const d=Date.now()-ts;if(d<60000)return'hace un momento';if(d<3600000)return`hace ${Math.floor(d/60000)} min`;if(d<86400000)return`hace ${Math.floor(d/3600000)}h`;if(d<604800000)return`hace ${Math.floor(d/86400000)}d`;return new Date(ts).toLocaleDateString('es-PE');};

  /* ─────────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────────────*/
  (function init() {
    if (CONFIG.USE_SUPABASE) SB.init();
    const p=new URLSearchParams(window.location.search);
    if(p.get('rol'))      sessionStorage.setItem('kausay_demo_rol',     p.get('rol'));
    if(p.get('nombre'))   sessionStorage.setItem('kausay_demo_nombre',  decodeURIComponent(p.get('nombre')));
    if(p.get('gerencia')) sessionStorage.setItem('kausay_demo_gerencia',p.get('gerencia'));
    Telemetry.appOpen();
    if(navigator.onLine) WQ.flush();
    if(!navigator.onLine) EB.emit('app:offline',{});
    // Carga inicial en Supabase (no bloquea — actualiza en background)
    if(CONFIG.USE_SUPABASE) loadInitialData();
  })();


  // ── INTEGRACIONES WRITE ───────────────────────────────────
  function setIntegracion(sistema, data) {
    const db = LA.load();
    if (!db.integraciones) db.integraciones = [];
    const idx = db.integraciones.findIndex(i=>i.sistema===sistema);
    const entry = {
      sistema, estado:data.estado||'activo',
      freshness:data.freshness??100,
      ultima_sync:data.ultima_sync||Date.now(),
      error:data.error||null,
      ...data,
    };
    if (idx>=0) db.integraciones[idx]=entry; else db.integraciones.push(entry);
    LA.save(db);
    Cache.invalidate('integraciones');
    EB.emit('integracion:updated', entry);
    if (CONFIG.USE_SUPABASE && SB._sb) {
      SB._sb.from('integraciones_sync_status').upsert({
        municipalidad_id: _getMuniId(), sistema,
        estado: entry.estado, ultima_sync: new Date(entry.ultima_sync).toISOString(),
        ultimo_error: entry.error||null,
      }, { onConflict: 'municipalidad_id,sistema' }).catch(e=>console.warn('[SB setIntegracion]',e));
    }
  }

  function recordSyncSuccess(sistema, registros=0) {
    setIntegracion(sistema, { estado:'activo', freshness:100, ultima_sync:Date.now(), error:null });
    Audit.emit('importacion',sistema,`Sync ${sistema}`,'import',null,{registros,fuente:sistema});
    Telemetry.track('sync_success',{sistema,registros});
  }

  function recordSyncError(sistema, errorMsg, reintentos=0) {
    const db  = LA.load();
    const cur = (db.integraciones||[]).find(i=>i.sistema===sistema);
    const fresh = Math.max(0, (cur?.freshness||100) - 25);
    setIntegracion(sistema,{estado:reintentos>=3?'desconectado':'degradado', freshness:fresh, error:errorMsg});
    Telemetry.track('sync_error',{sistema,error:errorMsg});
  }

  /* ─────────────────────────────────────────────────────────────
     INTERFAZ PÚBLICA — idéntica a v2
  ───────────────────────────────────────────────────────────────*/
  return {
    CONFIG, Audit, Telemetry, EventBus:EB, WriteQueue:WQ, Cache,
    getMuni, setMuni,
    getGerencias, getGerencia, updateGerencia,
    getInstrucciones, addInstruccion, confirmarInstruccion, responderInstruccion, getPendientesCount,
    getCompromisos, addCompromiso, updateCompromiso,
    getObras, updateAvanceObra, calcRiesgoObra,
    getAgenda, addAgenda,
    getDocumentos, addDocumento, updateDocumento,
    getAlertas, getAlertasActivas, addAlerta, marcarAlertaLeida,
    getPresupuesto, getPresupuestoArea,
    getPlazos, getCriticos,
    getIndicadores, updateIndicador,
    getIntegraciones,
    getResumenEjecutivo, getResumenEjecutivoAsync, getDecisionesDelDia,
    subscribeRealtime, unsubscribeRealtime,
    loadInitialData,
    getResumenEjecutivoAsync, getBadgesAsync,
    getGerenciasResumen, getResumenGerencia,
    exportarAuditLog:()=>{const b=JSON.parse(localStorage.getItem('kausay_audit')||'[]');Audit.onExport('audit','auditoria',b.length);return b;},
    reset:()=>LA.reset(),
    fmt, pctColor, pctBg, pctLabel, riesgoColor, relativeTime,
  };
})();
