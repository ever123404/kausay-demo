/* ══════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — shared.js
   Cerebro compartido de datos entre todos los dashboards.
   Usa localStorage para persistir entre páginas.
   ══════════════════════════════════════════════════════════════ */

const KausayDB = (function () {

  const KEY = 'kausay_db';

  /* ── ESTADO INICIAL (datos demo Cajamarca) ── */
  const INITIAL = {
    municipalidad: {
      nombre: 'Municipalidad Provincial de Cajamarca',
      tipo: 'provincial',
      alcalde: 'Roberto Sánchez Quiroz',
      secretaria: 'Carmen Flores Ríos',
      gm: 'Mg. Carlos Vásquez Díaz',
      ubigeo: '060101',
    },
    gerencias: [
      { cod:'INFRA',     nombre:'Infraestructura y Obras',    jefe:'Ing. Ana Quispe Herrera',   color:'#0F6E56', ejec:71, obras:18, comp_ven:2 },
      { cod:'RENTAS',    nombre:'Rentas y Tributación',        jefe:'Cont. Carlos Herrera Díaz', color:'#185FA5', ejec:41, obras:0,  comp_ven:2 },
      { cod:'SERVICIOS', nombre:'Servicios Municipales',       jefe:'Lic. Rosa Castro Vega',     color:'#5C3E8F', ejec:56, obras:3,  comp_ven:2 },
      { cod:'SOCIAL',    nombre:'Desarrollo Social',           jefe:'Lic. Marco Torres León',    color:'#B5540A', ejec:78, obras:4,  comp_ven:0 },
      { cod:'SECRETARIA',nombre:'Secretaría General',          jefe:'Abg. Patricia Abanto R.',   color:'#4A4A70', ejec:68, obras:0,  comp_ven:0 },
      { cod:'PLANIF',    nombre:'Planeamiento y Presupuesto',  jefe:'Econ. Eduardo Lima Soto',   color:'#2E6B5E', ejec:39, obras:0,  comp_ven:1 },
    ],
    instrucciones: [
      { id:'i1', de:'Alcalde', para:'GM', tipo:'instruccion', txt:'Convocar urgente al contratista de Jr. Lima para mañana 9am. Si no confirma antes de las 5pm, iniciamos resolución de contrato.', hora:'09:15', leida:false, respuesta:'' },
      { id:'i2', de:'Alcalde', para:'PLANIF', tipo:'consulta', txt:'¿Cuánto saldo sin ejecutar queda en Planeamiento? Necesito el plan de devengado antes del 15 dic.', hora:'Ayer 16:40', leida:true, respuesta:'Saldo de S/1.2M. Preparando plan de acción.' },
    ],
    compromisos: [
      { id:'c1', ttl:'Gestionar agua potable sector Los Pinos',  resp:'SERVICIOS', origen:'campo',    fec:'22 Nov', ven:true  },
      { id:'c2', ttl:'Instalar alumbrado plaza Las Torrecitas',  resp:'INFRA',     origen:'campo',    fec:'25 Nov', ven:true  },
      { id:'c3', ttl:'Responder pedido regidor Mamani — vías',   resp:'GM',        origen:'concejo',  fec:'28 Nov', ven:false },
      { id:'c4', ttl:'Informe de cierre de año al concejo',      resp:'PLANIF',    origen:'concejo',  fec:'05 Dic', ven:false },
    ],
    obras: [
      { id:'o1', gerencia:'INFRA', nombre:'Pavimentación Jr. Lima cuadra 8-12', estado:'paralizada', pct:34, presup:480000,  fin:'15 Dic', riesgo:'critico'  },
      { id:'o2', gerencia:'INFRA', nombre:'Construcción mercado La Colmena',    estado:'ejecucion',  pct:68, presup:1200000, fin:'28 Feb', riesgo:'medio'    },
      { id:'o3', gerencia:'INFRA', nombre:'Red agua potable sector norte',      estado:'ejecucion',  pct:51, presup:680000,  fin:'31 Mar', riesgo:'medio'    },
      { id:'o4', gerencia:'SERVICIOS', nombre:'Planta residuos sólidos este',   estado:'ejecucion',  pct:38, presup:2100000, fin:'Sep 25', riesgo:'alto'     },
      { id:'o5', gerencia:'SERVICIOS', nombre:'Mejoramiento parque principal',  estado:'ejecucion',  pct:82, presup:95000,   fin:'08 Dic', riesgo:'bajo'     },
      { id:'o6', gerencia:'SOCIAL',    nombre:'Centro de salud Baños del Inca', estado:'licitacion', pct:0,  presup:920000,  fin:'Jun 25', riesgo:'bajo'     },
    ],
    agenda: [
      { id:'a1', hora:'08:30', dur:'1h',    ttl:'Reunión de staff semanal',           lugar:'Sala de regidores', tipo:'interna',  br:true  },
      { id:'a2', hora:'10:00', dur:'45min', ttl:'Visita supervisión obra Jr. Lima',    lugar:'Jr. Lima cuadra 8', tipo:'campo',    br:true  },
      { id:'a3', hora:'12:30', dur:'30min', ttl:'Audiencia — Comunidad San Sebastián', lugar:'Despacho',          tipo:'audiencia',br:false },
      { id:'a4', hora:'15:00', dur:'2h',    ttl:'Sesión ordinaria Concejo Municipal',  lugar:'Sala principal',    tipo:'concejo',  br:true  },
      { id:'a5', hora:'18:00', dur:'1h',    ttl:'Firma de documentos pendientes',      lugar:'Despacho',          tipo:'admin',    br:false },
    ],
    documentos: [
      { id:'d1', ttl:'Resolución de Alcaldía N°421-2024',  sub:'Modificación presupuestaria S/85,000',      urg:'urgente', estado:'pendiente' },
      { id:'d2', ttl:'Convenio Marco — Universidad UNC',    sub:'Pasantías y asistencia técnica · 2 años',   urg:'normal',  estado:'pendiente' },
      { id:'d3', ttl:'Contrato servicio limpieza N°089',    sub:'Renovación enero–diciembre 2025',           urg:'normal',  estado:'pendiente' },
    ],
    plazos: [
      { id:'p1', sistema:'MEF/SIAF',   desc:'Devengado 4to trimestre',         dias:18, resp:'PLANIF',    niv:'critico'  },
      { id:'p2', sistema:'Invierte.pe',desc:'Actualizar avance 3 proyectos',   dias:11, resp:'INFRA',     niv:'critico'  },
      { id:'p3', sistema:'Contraloría',desc:'Subsanación hallazgos CGR 2024',  dias:24, resp:'GM',        niv:'alerta'   },
      { id:'p4', sistema:'SEACE',      desc:'Renovación contratos servicios',  dias:35, resp:'SERVICIOS', niv:'info'     },
    ],
    alertas: [
      { id:'al1', ico:'🚨', ttl:'Obra Jr. Lima paralizada · 26 días',      desc:'Sin avance desde el 24 oct. S/480K en riesgo.',           niv:'critico', area:'INFRA',    leida:false },
      { id:'al2', ico:'⏰', ttl:'Plazo MEF vence en 18 días',              desc:'S/1.2M sin devengar en Planeamiento.',                    niv:'alerta',  area:'PLANIF',   leida:false },
      { id:'al3', ico:'⚠️', ttl:'5 compromisos vencidos sin respuesta',    desc:'Rentas (2), Servicios (2), Planeamiento (1).',            niv:'alerta',  area:'GM',       leida:false },
      { id:'al4', ico:'📋', ttl:'3 documentos esperan tu firma',           desc:'Resolución N°421, Convenio UNC, Contrato limpieza.',      niv:'info',    area:'Secretaría',leida:false },
    ],
    presupuesto: {
      total: 7830000,
      ejecutado: 5248100,
      pct_global: 67,
      por_area: [
        { cod:'INFRA',     asig:4850000, ejec:3421000, pct:71 },
        { cod:'SOCIAL',    asig:1200000, ejec:940000,  pct:78 },
        { cod:'RENTAS',    asig:380000,  ejec:155000,  pct:41 },
        { cod:'SERVICIOS', asig:920000,  ejec:512000,  pct:56 },
        { cod:'SECRETARIA',asig:290000,  ejec:198000,  pct:68 },
        { cod:'PLANIF',    asig:185000,  ejec:72000,   pct:39 },
      ],
    },
    kpis_gerencias: {
      INFRA:    [{ n:'Metros pavimentados',  v:2840, meta:4500, u:'ml'      },{ n:'Obras entregadas', v:11,   meta:18,  u:'obras' }],
      RENTAS:   [{ n:'Recaudación del mes',  v:185420,meta:310000,u:'S/'   },{ n:'Contribuyentes al día',v:3840,meta:5200,u:'contrib.'}],
      SERVICIOS:[{ n:'Toneladas/día recogidas',v:28,meta:35,u:'ton/día'    },{ n:'Cobertura limpieza',v:78,meta:95,u:'%'}],
      SOCIAL:   [{ n:'Atenciones salud',     v:1840, meta:2400,u:'atenc.'  },{ n:'Beneficiarios programas',v:3240,meta:3800,u:'benef.'}],
      SECRETARIA:[{ n:'Expedientes resueltos',v:231,  meta:284, u:'exp.'   },{ n:'Documentos notificados',v:196,meta:220,u:'docs'}],
      PLANIF:   [{ n:'Ejecución presup. %',  v:39,   meta:75,  u:'%'       },{ n:'Informes emitidos',v:9,meta:12,u:'inform.'}],
    },
  };

  /* ── PERSISTENCIA ── */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return JSON.parse(JSON.stringify(INITIAL)); // deep copy
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch(e) {}
  }

  function reset() {
    localStorage.removeItem(KEY);
    return JSON.parse(JSON.stringify(INITIAL));
  }

  /* ── API PÚBLICA ── */
  return {

    /* Config de municipalidad */
    getMuni() { return load().municipalidad; },
    setMuni(data) { const db=load(); Object.assign(db.municipalidad, data); save(db); },

    /* Gerencias */
    getGerencias() { return load().gerencias; },
    getGerencia(cod) { return load().gerencias.find(g=>g.cod===cod); },
    updateGerencia(cod, data) {
      const db=load();
      const idx=db.gerencias.findIndex(g=>g.cod===cod);
      if(idx>=0) Object.assign(db.gerencias[idx], data);
      save(db);
    },

    /* Instrucciones */
    getInstrucciones(para) {
      const db=load();
      return para ? db.instrucciones.filter(i=>i.para===para) : db.instrucciones;
    },
    addInstruccion(instr) {
      const db=load();
      db.instrucciones.unshift({ id:'i'+Date.now(), ...instr, hora: new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}), leida:false, respuesta:'' });
      save(db);
      return db.instrucciones[0];
    },
    confirmarInstruccion(id) {
      const db=load();
      const i=db.instrucciones.find(x=>x.id===id);
      if(i){ i.leida=true; i.leida_en=new Date().toISOString(); }
      save(db); return i;
    },
    responderInstruccion(id, respuesta) {
      const db=load();
      const i=db.instrucciones.find(x=>x.id===id);
      if(i){ i.respuesta=respuesta; i.leida=true; }
      save(db); return i;
    },
    getPendientesCount(para) {
      return load().instrucciones.filter(i=>i.para===para && !i.leida).length;
    },

    /* Compromisos */
    getCompromisos(resp) {
      const db=load();
      return resp ? db.compromisos.filter(c=>c.resp===resp) : db.compromisos;
    },
    addCompromiso(comp) {
      const db=load();
      db.compromisos.unshift({ id:'c'+Date.now(), ...comp });
      save(db); return db.compromisos[0];
    },
    updateCompromiso(id, data) {
      const db=load();
      const c=db.compromisos.find(x=>x.id===id);
      if(c) Object.assign(c, data);
      save(db);
    },

    /* Obras */
    getObras(gerencia) {
      const db=load();
      return gerencia ? db.obras.filter(o=>o.gerencia===gerencia) : db.obras;
    },
    updateObra(id, data) {
      const db=load();
      const o=db.obras.find(x=>x.id===id);
      if(o) Object.assign(o, data);
      save(db);
    },
    addAvanceObra(id, pct) {
      const db=load();
      const o=db.obras.find(x=>x.id===id);
      if(o){ o.pct=pct; o.ultimo_avance=new Date().toISOString(); }
      save(db); return o;
    },

    /* Agenda */
    getAgenda() { return load().agenda; },
    addAgenda(item) {
      const db=load();
      db.agenda.push({ id:'a'+Date.now(), ...item });
      db.agenda.sort((a,b)=>a.hora.localeCompare(b.hora));
      save(db);
    },

    /* Documentos */
    getDocumentos() { return load().documentos; },
    updateDocumento(id, estado) {
      const db=load();
      const d=db.documentos.find(x=>x.id===id);
      if(d){ d.estado=estado; d.fecha_accion=new Date().toISOString(); }
      save(db);
    },
    addDocumento(doc) {
      const db=load();
      db.documentos.unshift({ id:'d'+Date.now(), estado:'pendiente', ...doc });
      save(db);
    },

    /* Plazos */
    getPlazos() { return load().plazos; },
    getCriticos() { return load().plazos.filter(p=>p.niv==='critico'); },

    /* Alertas */
    getAlertas() { return load().alertas; },
    marcarAlertaLeida(id) {
      const db=load();
      const a=db.alertas.find(x=>x.id===id);
      if(a) a.leida=true;
      save(db);
    },
    getAlertasNoLeidas() { return load().alertas.filter(a=>!a.leida); },

    /* Presupuesto */
    getPresupuesto() { return load().presupuesto; },
    getPresupuestoArea(cod) {
      return load().presupuesto.por_area.find(p=>p.cod===cod);
    },

    /* KPIs */
    getKPIs(cod) { return load().kpis_gerencias[cod] || []; },
    updateKPI(cod, idx, valor) {
      const db=load();
      if(db.kpis_gerencias[cod] && db.kpis_gerencias[cod][idx]) {
        db.kpis_gerencias[cod][idx].v = valor;
      }
      save(db);
    },

    /* Resumen ejecutivo (para pantalla del alcalde) */
    getResumenEjecutivo() {
      const db=load();
      const alertas_criticas = db.alertas.filter(a=>a.niv==='critico'&&!a.leida).length;
      const obras_riesgo = db.obras.filter(o=>o.riesgo==='critico'||o.riesgo==='alto').length;
      const compromisos_ven = db.compromisos.filter(c=>c.ven).length;
      const docs_pendientes = db.documentos.filter(d=>d.estado==='pendiente').length;
      const instr_sin_leer = db.instrucciones.filter(i=>!i.leida).length;
      const dias_mef = db.plazos.find(p=>p.id==='p1')?.dias || 0;
      return {
        alertas_criticas,
        obras_riesgo,
        compromisos_ven,
        docs_pendientes,
        instr_sin_leer,
        dias_mef,
        ejec_global: db.presupuesto.pct_global,
        agenda_hoy: db.agenda.length,
        estado: alertas_criticas >= 2 ? 'critico' : alertas_criticas >= 1 ? 'alerta' : 'normal',
      };
    },

    /* Utilidades */
    reset,
    fmt: n => n>=1000000 ? 'S/'+( n/1000000).toFixed(1)+'M' : n>=1000 ? 'S/'+(n/1000).toFixed(0)+'K' : 'S/'+n,
    pctColor: p => p>=70 ? '#1A7A45' : p>=50 ? '#C8880A' : '#B02020',
    pctLabel: p => p>=70 ? 'Normal' : p>=50 ? 'En riesgo' : 'Crítico',
  };

})();
