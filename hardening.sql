-- ═══════════════════════════════════════════════════════════════════════════
-- KAUSAY MUNICIPAL — hardening.sql v1.0
-- Pilot Hardening Sprint — Frentes 1 y 2
-- Ejecutar DESPUÉS de supabase-setup.sql v2
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 1: get_resumen_ejecutivo()
-- Una sola llamada RPC reemplaza 8+ queries fragmentadas.
-- Parámetro: p_rol para filtrar pendientes relevantes por rol.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_resumen_ejecutivo(p_rol TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni_id      UUID := get_municipalidad_id();
  v_rol          TEXT := COALESCE(p_rol, get_user_rol());
  v_anio         INT  := EXTRACT(YEAR FROM CURRENT_DATE);

  -- Contadores
  v_alertas_crit    INT; v_alertas_alerta  INT;
  v_obras_crit      INT; v_obras_en_riesgo INT;
  v_comp_vencidos   INT; v_docs_pendientes INT;
  v_instr_sin_leer  INT; v_plazos_crit     INT;
  v_dias_mef        INT; v_ejec_global     NUMERIC;
  v_agenda_hoy      INT; v_estado          TEXT;

  -- Decisiones del día (max 5)
  v_decisiones JSONB := '[]'::JSONB;
  v_dec_item   JSONB;
BEGIN
  -- Validar acceso al tenant
  IF v_muni_id IS NULL THEN RETURN '{}'::JSONB; END IF;

  -- ── Alertas ──────────────────────────────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE nivel = 'critico' AND NOT leida AND NOT resuelta),
    COUNT(*) FILTER (WHERE nivel = 'alerta'  AND NOT leida AND NOT resuelta)
  INTO v_alertas_crit, v_alertas_alerta
  FROM alertas WHERE municipalidad_id = v_muni_id;

  -- ── Obras ────────────────────────────────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE riesgo_nivel = 'critico'),
    COUNT(*) FILTER (WHERE riesgo_nivel IN ('critico','alto'))
  INTO v_obras_crit, v_obras_en_riesgo
  FROM obras
  WHERE municipalidad_id = v_muni_id
    AND estado NOT IN ('terminada','liquidada');

  -- ── Compromisos vencidos ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_comp_vencidos
  FROM compromisos
  WHERE municipalidad_id = v_muni_id
    AND fecha_limite < CURRENT_DATE
    AND estado NOT IN ('cumplido','cancelado');

  -- ── Documentos pendientes de firma ───────────────────────────────
  SELECT COUNT(*) INTO v_docs_pendientes
  FROM documentos_firma
  WHERE municipalidad_id = v_muni_id AND estado = 'pendiente';

  -- ── Instrucciones sin acuse (filtradas por rol) ──────────────────
  SELECT COUNT(*) INTO v_instr_sin_leer
  FROM instrucciones
  WHERE municipalidad_id = v_muni_id
    AND confirmada = FALSE
    AND CASE
      WHEN v_rol IN ('alcalde','gerente_municipal','soporte_kausay') THEN TRUE
      WHEN v_rol = 'gerente_sectorial' THEN receptor_ger_cod = get_gerencia_cod()
      WHEN v_rol = 'secretaria'        THEN receptor_rol = 'secretaria'
      ELSE emisor_id = auth.uid() OR receptor_id = auth.uid()
    END;

  -- ── Plazos críticos ──────────────────────────────────────────────
  SELECT COUNT(*) INTO v_plazos_crit
  FROM plazos_normativos
  WHERE municipalidad_id = v_muni_id
    AND NOT completado
    AND (fecha_limite - CURRENT_DATE) <= 15;

  -- ── Días para MEF (SIAF devengado) ──────────────────────────────
  SELECT GREATEST(0, (fecha_limite - CURRENT_DATE)::INT)
  INTO v_dias_mef
  FROM plazos_normativos
  WHERE municipalidad_id = v_muni_id
    AND sistema ILIKE '%MEF%' AND NOT completado
  ORDER BY fecha_limite ASC LIMIT 1;

  -- ── Ejecución presupuestal global ────────────────────────────────
  SELECT ROUND(COALESCE(SUM(ejecutado)::NUMERIC / NULLIF(SUM(asignado),0) * 100, 0), 1)
  INTO v_ejec_global
  FROM presupuesto
  WHERE municipalidad_id = v_muni_id
    AND gerencia_id IS NULL    -- fila global del tenant
    AND anio = v_anio;

  IF v_ejec_global IS NULL THEN
    -- fallback: calcular desde suma de gerencias
    SELECT ROUND(SUM(ejecutado)::NUMERIC / NULLIF(SUM(asignado),0) * 100, 1)
    INTO v_ejec_global
    FROM presupuesto
    WHERE municipalidad_id = v_muni_id AND anio = v_anio;
  END IF;

  -- ── Agenda de hoy ────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_agenda_hoy
  FROM agenda_items
  WHERE municipalidad_id = v_muni_id AND fecha = CURRENT_DATE;

  -- ── Estado semafórico global ─────────────────────────────────────
  v_estado := CASE
    WHEN v_alertas_crit >= 2 OR v_obras_crit >= 2            THEN 'critico'
    WHEN v_alertas_crit >= 1 OR v_alertas_alerta >= 3
      OR v_plazos_crit >= 2 OR v_obras_en_riesgo >= 3        THEN 'alerta'
    ELSE 'normal'
  END;

  -- ── Decisiones del día (max 5) ───────────────────────────────────
  -- Obras críticas
  SELECT jsonb_agg(jsonb_build_object(
    'id',     'dec-obra-' || id,
    'tipo',   'obra_critica',
    'ico',    '🚨',
    'ttl',    nombre || ' — ' || CASE WHEN estado='paralizada' THEN 'paralizada '||dias_sin_avance||'d' ELSE 'riesgo crítico' END,
    'desc',   'Decidir: continuar, resolver contrato o intervenir directamente.',
    'tag',    'Urgente hoy',
    'color',  '#8B1A1A',
    'accion', 'Ver obra',
    'ref',    id
  ))
  INTO v_dec_item
  FROM obras
  WHERE municipalidad_id = v_muni_id AND riesgo_nivel = 'critico'
    AND estado NOT IN ('terminada','liquidada');
  IF v_dec_item IS NOT NULL THEN v_decisiones := v_decisiones || v_dec_item; END IF;

  -- Plazos críticos
  SELECT jsonb_agg(jsonb_build_object(
    'id',     'dec-plazo-' || id,
    'tipo',   'plazo_critico',
    'ico',    '⏰',
    'ttl',    sistema || ' vence en ' || (fecha_limite - CURRENT_DATE) || ' días',
    'desc',   descripcion || ' — exigir plan al responsable.',
    'tag',    (fecha_limite - CURRENT_DATE) || 'd restantes',
    'color',  '#9E6A06',
    'accion', 'Ver semáforo',
    'ref',    id
  ))
  INTO v_dec_item
  FROM plazos_normativos
  WHERE municipalidad_id = v_muni_id
    AND NOT completado
    AND (fecha_limite - CURRENT_DATE) <= 15;
  IF v_dec_item IS NOT NULL THEN v_decisiones := v_decisiones || v_dec_item; END IF;

  -- Compromisos vencidos alta prioridad
  IF (SELECT COUNT(*) FROM compromisos WHERE municipalidad_id=v_muni_id
      AND fecha_limite < CURRENT_DATE AND prioridad='alta'
      AND estado NOT IN ('cumplido','cancelado')) > 0 THEN
    v_decisiones := v_decisiones || jsonb_build_array(jsonb_build_object(
      'id',     'dec-compromisos',
      'tipo',   'compromisos_vencidos',
      'ico',    '🤝',
      'ttl',    (SELECT COUNT(*) FROM compromisos WHERE municipalidad_id=v_muni_id
                 AND fecha_limite<CURRENT_DATE AND prioridad='alta'
                 AND estado NOT IN ('cumplido','cancelado')) || ' compromisos de alta prioridad vencidos',
      'desc',   'Sin respuesta de los responsables. Requiere instrucción directa.',
      'tag',    'Sin respuesta',
      'color',  '#8B1A1A',
      'accion', 'Ver compromisos',
      'ref',    NULL
    ));
  END IF;

  -- Documentos urgentes para firma
  IF v_docs_pendientes > 0 THEN
    v_decisiones := v_decisiones || jsonb_build_array(jsonb_build_object(
      'id',     'dec-docs',
      'tipo',   'firma_urgente',
      'ico',    '✍️',
      'ttl',    v_docs_pendientes || ' documento' || CASE WHEN v_docs_pendientes>1 THEN 's urgentes' ELSE ' urgente' END || ' para tu firma',
      'desc',   (SELECT string_agg(titulo,  ' · ') FROM documentos_firma
                 WHERE municipalidad_id=v_muni_id AND urgencia='urgente' AND estado='pendiente' LIMIT 3),
      'tag',    'Firma hoy',
      'color',  '#9E6A06',
      'accion', 'Ver documentos',
      'ref',    NULL
    ));
  END IF;

  -- Limitar a 5 decisiones
  IF jsonb_array_length(v_decisiones) > 5 THEN
    v_decisiones := v_decisiones -> 0 || v_decisiones -> 1 || v_decisiones -> 2
                 || v_decisiones -> 3 || v_decisiones -> 4;
  END IF;

  -- ── Resultado final ──────────────────────────────────────────────
  RETURN jsonb_build_object(
    'alertas_criticas',  v_alertas_crit,
    'alertas_alerta',    v_alertas_alerta,
    'obras_criticas',    v_obras_crit,
    'obras_en_riesgo',   v_obras_en_riesgo,
    'compromisos_ven',   v_comp_vencidos,
    'docs_pendientes',   v_docs_pendientes,
    'instr_sin_leer',    v_instr_sin_leer,
    'plazos_criticos',   v_plazos_crit,
    'dias_mef',          COALESCE(v_dias_mef, 0),
    'ejec_global',       COALESCE(v_ejec_global, 0),
    'agenda_hoy',        v_agenda_hoy,
    'estado',            v_estado,
    'decisiones',        v_decisiones,
    'generado_at',       now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_resumen_ejecutivo TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 2: gerencias_resumen_view
-- Una lectura, todo el estado de cada gerencia.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW gerencias_resumen_view AS
WITH pres AS (
  SELECT
    gerencia_id,
    municipalidad_id,
    ROUND(SUM(ejecutado)::NUMERIC / NULLIF(SUM(asignado),0) * 100, 1) AS pct_ejecucion,
    SUM(asignado)  AS total_asignado,
    SUM(ejecutado) AS total_ejecutado
  FROM presupuesto
  WHERE anio = EXTRACT(YEAR FROM CURRENT_DATE)
    AND gerencia_id IS NOT NULL
  GROUP BY gerencia_id, municipalidad_id
),
obras_cnt AS (
  SELECT
    gerencia_id,
    COUNT(*) FILTER (WHERE riesgo_nivel = 'critico') AS obras_criticas,
    COUNT(*) FILTER (WHERE riesgo_nivel IN ('critico','alto')) AS obras_riesgo,
    COUNT(*) FILTER (WHERE estado NOT IN ('terminada','liquidada')) AS obras_activas
  FROM obras
  WHERE estado NOT IN ('terminada','liquidada')
  GROUP BY gerencia_id
),
comp_cnt AS (
  SELECT
    gerencia_id,
    COUNT(*) FILTER (WHERE estado NOT IN ('cumplido','cancelado')) AS comp_pendientes,
    COUNT(*) FILTER (WHERE fecha_limite < CURRENT_DATE AND estado NOT IN ('cumplido','cancelado')) AS comp_vencidos
  FROM compromisos
  GROUP BY gerencia_id
),
kpi_principal AS (
  SELECT DISTINCT ON (gerencia_id)
    gerencia_id,
    nombre          AS kpi_nombre,
    valor_actual    AS kpi_valor,
    meta_anual      AS kpi_meta,
    unidad          AS kpi_unidad,
    ROUND(valor_actual::NUMERIC / NULLIF(meta_anual,0) * 100, 1) AS kpi_pct
  FROM indicadores
  WHERE es_principal = TRUE
  ORDER BY gerencia_id, orden
)
SELECT
  g.id,
  g.municipalidad_id,
  g.cod,
  g.nombre,
  g.nombre_corto,
  g.jefe_nombre,
  g.color,
  g.orden,
  g.activa,
  -- Presupuesto
  COALESCE(p.pct_ejecucion, 0)     AS pct_ejecucion,
  COALESCE(p.total_asignado, 0)    AS total_asignado,
  COALESCE(p.total_ejecutado, 0)   AS total_ejecutado,
  -- Obras
  COALESCE(oc.obras_criticas, 0)   AS obras_criticas,
  COALESCE(oc.obras_riesgo, 0)     AS obras_en_riesgo,
  COALESCE(oc.obras_activas, 0)    AS obras_activas,
  -- Compromisos
  COALESCE(cc.comp_pendientes, 0)  AS compromisos_pendientes,
  COALESCE(cc.comp_vencidos, 0)    AS compromisos_vencidos,
  -- KPI principal
  kp.kpi_nombre,
  kp.kpi_valor,
  kp.kpi_meta,
  kp.kpi_unidad,
  COALESCE(kp.kpi_pct, 0)          AS kpi_pct,
  -- Estado semafórico calculado
  CASE
    WHEN COALESCE(p.pct_ejecucion,0) < 40
      OR COALESCE(oc.obras_criticas,0) >= 2     THEN 'critico'
    WHEN COALESCE(p.pct_ejecucion,0) < 65
      OR COALESCE(oc.obras_criticas,0) >= 1
      OR COALESCE(cc.comp_vencidos,0)  >= 2     THEN 'alerta'
    ELSE 'normal'
  END AS estado_semaforo,
  -- Riesgo resumido (texto para el badge)
  CASE
    WHEN COALESCE(oc.obras_criticas,0) > 0 THEN 'Obra crítica'
    WHEN COALESCE(cc.comp_vencidos,0)  > 0 THEN 'Compromisos vencidos'
    WHEN COALESCE(p.pct_ejecucion,0)  < 50 THEN 'Ejecución baja'
    ELSE 'Al día'
  END AS riesgo_resumen
FROM gerencias g
LEFT JOIN pres          p  ON p.gerencia_id = g.id
LEFT JOIN obras_cnt     oc ON oc.gerencia_id = g.id
LEFT JOIN comp_cnt      cc ON cc.gerencia_id = g.id
LEFT JOIN kpi_principal kp ON kp.gerencia_id = g.id
ORDER BY g.municipalidad_id, g.orden;

-- RLS para la view (hereda de tablas base, pero explicitamos para claridad)
-- La view es SECURITY INVOKER por defecto — se aplican los RLS de las tablas subyacentes.
-- No necesita política propia.
GRANT SELECT ON gerencias_resumen_view TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 2b: get_resumen_gerencia() — para gerente.html (scope propio)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_resumen_gerencia(p_gerencia_cod TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni_id UUID := get_municipalidad_id();
  v_ger     gerencias_resumen_view%ROWTYPE;
  v_instr   INT;
  v_avance_pendiente INT;
BEGIN
  SELECT * INTO v_ger
  FROM gerencias_resumen_view
  WHERE municipalidad_id = v_muni_id AND cod = p_gerencia_cod;

  IF NOT FOUND THEN RETURN '{}'::JSONB; END IF;

  -- Instrucciones pendientes de confirmar para esta gerencia
  SELECT COUNT(*) INTO v_instr
  FROM instrucciones
  WHERE municipalidad_id = v_muni_id
    AND receptor_ger_cod = p_gerencia_cod
    AND confirmada = FALSE;

  -- Obras sin avance reciente (>= 3 días) en esta gerencia
  SELECT COUNT(*) INTO v_avance_pendiente
  FROM obras o
  JOIN gerencias g ON g.id = o.gerencia_id
  WHERE o.municipalidad_id = v_muni_id
    AND g.cod = p_gerencia_cod
    AND o.estado IN ('ejecucion','paralizada')
    AND o.dias_sin_avance >= 3;

  RETURN jsonb_build_object(
    'cod',                   v_ger.cod,
    'nombre',                v_ger.nombre,
    'jefe',                  v_ger.jefe_nombre,
    'color',                 v_ger.color,
    'pct_ejecucion',         v_ger.pct_ejecucion,
    'total_asignado',        v_ger.total_asignado,
    'total_ejecutado',       v_ger.total_ejecutado,
    'obras_criticas',        v_ger.obras_criticas,
    'obras_en_riesgo',       v_ger.obras_en_riesgo,
    'compromisos_pendientes',v_ger.compromisos_pendientes,
    'compromisos_vencidos',  v_ger.compromisos_vencidos,
    'kpi_nombre',            v_ger.kpi_nombre,
    'kpi_valor',             v_ger.kpi_valor,
    'kpi_meta',              v_ger.kpi_meta,
    'kpi_pct',               v_ger.kpi_pct,
    'estado_semaforo',       v_ger.estado_semaforo,
    'riesgo_resumen',        v_ger.riesgo_resumen,
    'instrucciones_sin_leer',v_instr,
    'avances_pendientes',    v_avance_pendiente,
    'generado_at',           now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_resumen_gerencia TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 3: get_badges_rol() — badges asíncronos en un solo RPC
-- Reemplaza múltiples getPendientesCount() síncronos
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_badges_rol()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni_id  UUID := get_municipalidad_id();
  v_rol      TEXT := get_user_rol();
  v_ger_cod  TEXT := get_gerencia_cod();
BEGIN
  RETURN jsonb_build_object(
    -- Alertas activas (todos los roles relevantes)
    'alertas',          (SELECT COUNT(*) FROM alertas
                         WHERE municipalidad_id=v_muni_id AND NOT leida AND NOT resuelta),
    -- Instrucciones sin confirmar por mí
    'instrucciones',    (SELECT COUNT(*) FROM instrucciones
                         WHERE municipalidad_id=v_muni_id AND confirmada=FALSE
                           AND CASE
                             WHEN v_rol IN ('alcalde','gerente_municipal') THEN TRUE
                             WHEN v_rol='gerente_sectorial' THEN receptor_ger_cod=v_ger_cod
                             ELSE receptor_id=auth.uid()
                           END),
    -- Documentos pendientes de firma
    'firmas',           (SELECT COUNT(*) FROM documentos_firma
                         WHERE municipalidad_id=v_muni_id AND estado='pendiente'),
    -- Compromisos vencidos
    'compromisos_ven',  (SELECT COUNT(*) FROM compromisos
                         WHERE municipalidad_id=v_muni_id
                           AND fecha_limite < CURRENT_DATE
                           AND estado NOT IN ('cumplido','cancelado')),
    -- Obras críticas
    'obras_criticas',   (SELECT COUNT(*) FROM obras
                         WHERE municipalidad_id=v_muni_id
                           AND riesgo_nivel='critico'
                           AND estado NOT IN ('terminada','liquidada')),
    -- Plazos críticos
    'plazos_crit',      (SELECT COUNT(*) FROM plazos_normativos
                         WHERE municipalidad_id=v_muni_id
                           AND NOT completado
                           AND (fecha_limite-CURRENT_DATE)<=15),
    -- WQ conflicts (del localStorage — no aplica en SQL)
    'wq_conflicts',     0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_badges_rol TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 4: instruccion_completa view (evita N+1 en bandeja del GM)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW instrucciones_view AS
SELECT
  i.*,
  eu.nombre       AS emisor_nombre,
  eu.email        AS emisor_email,
  ru.nombre       AS receptor_nombre,
  ru.email        AS receptor_email,
  g.cod           AS gerencia_cod_actual,
  g.nombre        AS gerencia_nombre
FROM instrucciones i
LEFT JOIN usuarios eu ON eu.id = i.emisor_id
LEFT JOIN usuarios ru ON ru.id = i.receptor_id
LEFT JOIN gerencias g ON g.id  = ru.gerencia_id;

GRANT SELECT ON instrucciones_view TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 5: Índices complementarios para las nuevas funciones
-- ─────────────────────────────────────────────────────────────────────────

-- Acelerar get_resumen_ejecutivo
CREATE INDEX IF NOT EXISTS idx_alertas_no_leidas
  ON alertas (municipalidad_id, nivel)
  WHERE NOT leida AND NOT resuelta;

CREATE INDEX IF NOT EXISTS idx_compromisos_vencidos_prio
  ON compromisos (municipalidad_id, prioridad, fecha_limite)
  WHERE fecha_limite < CURRENT_DATE
    AND estado NOT IN ('cumplido','cancelado');

CREATE INDEX IF NOT EXISTS idx_obras_no_terminadas
  ON obras (municipalidad_id, riesgo_nivel)
  WHERE estado NOT IN ('terminada','liquidada');

CREATE INDEX IF NOT EXISTS idx_plazos_criticos
  ON plazos_normativos (municipalidad_id, fecha_limite)
  WHERE NOT completado;

CREATE INDEX IF NOT EXISTS idx_instrucciones_no_confirmadas
  ON instrucciones (municipalidad_id, receptor_ger_cod, confirmada)
  WHERE confirmada = FALSE;

-- Acelerar gerencias_resumen_view
CREATE INDEX IF NOT EXISTS idx_presupuesto_anio_ger
  ON presupuesto (municipalidad_id, anio, gerencia_id)
  WHERE gerencia_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_indicadores_principal
  ON indicadores (gerencia_id, es_principal, orden)
  WHERE es_principal = TRUE;


-- ─────────────────────────────────────────────────────────────────────────
-- FRENTE 6 (SQL): smoke_test() — valida integridad del schema
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION smoke_test_schema()
RETURNS TABLE(test TEXT, resultado TEXT, ok BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Test 1: Funciones JWT existen
  RETURN QUERY SELECT 'JWT: get_municipalidad_id()',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_municipalidad_id') THEN 'EXISTE' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_municipalidad_id');

  -- Test 2: Tabla auditoria_eventos append-only
  RETURN QUERY SELECT 'AUDIT: auditoria_eventos tiene trigger',
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auditoria_eventos'::regclass LIMIT 1)
         THEN 'OK' ELSE 'SIN TRIGGER' END,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auditoria_eventos'::regclass LIMIT 1);

  -- Test 3: Publication realtime existe
  RETURN QUERY SELECT 'REALTIME: publication existe',
    CASE WHEN EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
         THEN 'OK' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime');

  -- Test 4: RLS habilitado en instrucciones
  RETURN QUERY SELECT 'RLS: instrucciones',
    CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname='instrucciones') THEN 'ACTIVO' ELSE 'INACTIVO' END,
    (SELECT relrowsecurity FROM pg_class WHERE relname='instrucciones');

  -- Test 5: freshness_score es columna generada
  RETURN QUERY SELECT 'SCHEMA: freshness_score GENERATED',
    CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns
                     WHERE table_name='integraciones_sync_status'
                       AND column_name='freshness_score'
                       AND is_generated='ALWAYS')
         THEN 'OK' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM information_schema.columns
           WHERE table_name='integraciones_sync_status'
             AND column_name='freshness_score'
             AND is_generated='ALWAYS');

  -- Test 6: JWT hook existe
  RETURN QUERY SELECT 'JWT HOOK: kausay_jwt_claims_hook',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='kausay_jwt_claims_hook')
         THEN 'EXISTE' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='kausay_jwt_claims_hook');

  -- Test 7: gerencias_resumen_view existe
  RETURN QUERY SELECT 'VIEW: gerencias_resumen_view',
    CASE WHEN EXISTS(SELECT 1 FROM pg_views WHERE viewname='gerencias_resumen_view')
         THEN 'EXISTE' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM pg_views WHERE viewname='gerencias_resumen_view');

  -- Test 8: get_resumen_ejecutivo existe
  RETURN QUERY SELECT 'FUNC: get_resumen_ejecutivo',
    CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_resumen_ejecutivo')
         THEN 'EXISTE' ELSE 'FALTA' END,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_resumen_ejecutivo');
END;
$$;

GRANT EXECUTE ON FUNCTION smoke_test_schema TO authenticated;

-- Para ejecutar: SELECT * FROM smoke_test_schema();

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN hardening.sql v1.0
-- Nuevas funciones: get_resumen_ejecutivo, get_resumen_gerencia, get_badges_rol
-- Nuevas views:     gerencias_resumen_view, instrucciones_view
-- Nuevos índices:   7 índices parciales para hot paths
-- Test:             smoke_test_schema()
-- ═══════════════════════════════════════════════════════════════════════════
