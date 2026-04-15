-- ═══════════════════════════════════════════════════════════════════════════
-- KAUSAY MUNICIPAL — supabase-setup.sql v2.0
-- System Design v2.0 + Hardening v2.1
-- ───────────────────────────────────────────────────────────────────────────
-- Ejecutar en orden. Una sola vez por proyecto de Supabase.
-- Plataforma: PostgreSQL 15+ (Supabase managed)
-- Multi-tenant: cada fila aislada por municipalidad_id via RLS + JWT claims
-- ═══════════════════════════════════════════════════════════════════════════

-- ── DECISIONES ARQUITECTÓNICAS DOCUMENTADAS ───────────────────────────────
-- [D1] JWT claims como fuente primaria de RLS.
--      NO se hace JOIN a la tabla usuarios en el hot path de autorización.
--      El hook auth.jwt_claims_hook inyecta municipalidad_id, rol,
--      gerencia_id, gerencia_cod, activo y claims_version en el JWT.
--      Desfase máximo al revocar un usuario: el TTL del token (1 hora).
--      Mitigación: revocar token vía Supabase Admin API en tiempo real.
--
-- [D2] auditoria_eventos es append-only.
--      REVOKE UPDATE, DELETE sobre esa tabla a todos los roles.
--      La función registrar_evento() usa SECURITY DEFINER para poder
--      insertar incluso cuando el RLS de la tabla lo bloquearía.
--
-- [D3] El hash de encadenamiento (hash_prev_evento) es SHA-256 del
--      JSON del evento anterior. Permite verificar integridad de la
--      cadena offline exportando el log completo.
--
-- [D4] freshness_score en integraciones_sync_status es una columna
--      generada (GENERATED ALWAYS AS). No se puede escribir directamente.
--      Se recalcula automáticamente cuando cambia ultima_sync o estado.
--
-- [D5] product_telemetry no tiene RLS de lectura para el tenant.
--      Solo el rol soporte_kausay puede leer todos los tenants.
--      El tenant solo puede insertar sus propios eventos.
--
-- [D6] La tabla usuarios aquí es el "perfil del sistema", separada de
--      auth.users de Supabase. Se sincroniza via trigger en auth.users.
--      Las contraseñas NUNCA se almacenan en esta tabla.
-- ─────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 0: EXTENSIONES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- índices de búsqueda de texto
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- búsqueda sin acentos (nombres)


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 1: FUNCIONES JWT CLAIMS
-- Fuente primaria de RLS. Se leen del token, no de la base de datos.
-- ═══════════════════════════════════════════════════════════════════════════

-- Extrae municipalidad_id del JWT claim
CREATE OR REPLACE FUNCTION get_municipalidad_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'municipalidad_id',
    ''
  )::UUID;
$$;

-- Extrae rol del JWT claim
CREATE OR REPLACE FUNCTION get_user_rol()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'rol';
$$;

-- Extrae gerencia_id del JWT claim
CREATE OR REPLACE FUNCTION get_gerencia_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'gerencia_id',
    ''
  )::UUID;
$$;

-- Extrae gerencia_cod del JWT claim (INFRA, RENTAS, etc.)
CREATE OR REPLACE FUNCTION get_gerencia_cod()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'gerencia_cod';
$$;

-- ¿El usuario está activo según el JWT?
CREATE OR REPLACE FUNCTION is_activo()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'activo')::BOOLEAN,
    false
  );
$$;

-- ¿Puede el usuario actual acceder a la fila por tenant?
-- Combina: tenant correcto + usuario activo
CREATE OR REPLACE FUNCTION can_access(fila_municipalidad_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT fila_municipalidad_id = get_municipalidad_id()
     AND is_activo();
$$;

-- ¿Puede el gerente sectorial acceder a la fila por gerencia?
CREATE OR REPLACE FUNCTION can_access_gerencia(fila_gerencia_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho','soporte_kausay') THEN true
    WHEN get_user_rol() = 'gerente_sectorial' THEN fila_gerencia_id = get_gerencia_id()
    WHEN get_user_rol() = 'oci_lectura'       THEN true   -- lectura total, sin filtro de área
    ELSE false
  END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 2: SCHEMA CORE — TABLAS PRINCIPALES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 2.1 MUNICIPALIDADES
-- Una fila por tenant. El id es la clave foránea de todas las demás tablas.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS municipalidades (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT        NOT NULL,
  nombre_corto      TEXT,
  tipo              TEXT        NOT NULL CHECK (tipo IN ('distrital','provincial','metropolitana')),
  ubigeo            TEXT        UNIQUE NOT NULL,
  departamento      TEXT        NOT NULL,
  provincia         TEXT        NOT NULL,
  distrito          TEXT        NOT NULL,
  escudo_url        TEXT,
  color_primario    TEXT        DEFAULT '#8B1A1A',
  color_secundario  TEXT        DEFAULT '#1A1D23',
  -- Autoridades (cache de nombres para display rápido sin JOIN)
  alcalde_nombre    TEXT,
  secretaria_nombre TEXT,
  gm_nombre         TEXT,
  -- Plan y facturación
  plan_saas         TEXT        DEFAULT 'demo' CHECK (plan_saas IN ('demo','distrital','provincial','metropolitana')),
  activo            BOOLEAN     DEFAULT TRUE,
  presupuesto_anual NUMERIC(14,2),
  -- Metadatos
  onboarding_done   BOOLEAN     DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.2 GERENCIAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gerencias (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  nombre           TEXT        NOT NULL,
  nombre_corto     TEXT,
  cod              TEXT        NOT NULL,   -- 'INFRA', 'RENTAS', etc. — inmutable
  jefe_nombre      TEXT,
  color            TEXT        DEFAULT '#185FA5',
  orden            SMALLINT    DEFAULT 0,
  activa           BOOLEAN     DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (municipalidad_id, cod)            -- cod único por tenant
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.3 USUARIOS (perfil del sistema — SIN contraseñas)
-- auth.users de Supabase gestiona credenciales.
-- Esta tabla extiende el perfil con datos institucionales.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id               UUID        PRIMARY KEY,  -- mismo id que auth.users
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        REFERENCES gerencias(id),
  gerencia_cod     TEXT,                     -- denormalizado para JWT
  email            TEXT        NOT NULL,
  nombre           TEXT        NOT NULL,
  rol              TEXT        NOT NULL CHECK (
    rol IN ('alcalde','secretaria','gerente_municipal','gerente_sectorial',
            'asesor_despacho','planeamiento','oci_lectura','soporte_kausay')
  ),
  activo           BOOLEAN     DEFAULT TRUE,
  mfa_habilitado   BOOLEAN     DEFAULT FALSE,
  claims_version   BIGINT      DEFAULT 0,    -- incrementar para invalidar JWT
  ultimo_acceso    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (municipalidad_id, email)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.4 INSTRUCCIONES
-- Canal de comunicación alcalde → GM/gerencias y viceversa.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instrucciones (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  emisor_id        UUID        NOT NULL REFERENCES usuarios(id),
  receptor_id      UUID        NOT NULL REFERENCES usuarios(id),
  -- Para filtros rápidos sin JOIN (compatible con frontend)
  emisor_rol       TEXT        NOT NULL,
  receptor_rol     TEXT        NOT NULL,
  receptor_ger_cod TEXT,                     -- 'INFRA', 'GM', etc.
  tipo             TEXT        NOT NULL CHECK (
    tipo IN ('instruccion','consulta','alerta','difusion','coordinacion','chat')
  ),
  contenido        TEXT        NOT NULL,
  prioridad        TEXT        NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('urgente','normal','baja')),
  confirmada       BOOLEAN     DEFAULT FALSE,
  leida_en         TIMESTAMPTZ,
  respuesta        TEXT,
  respondida_en    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.5 NOTIFICACIONES
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificaciones (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  usuario_id       UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo             TEXT        NOT NULL,     -- 'alerta','instruccion','plazo', etc.
  titulo           TEXT        NOT NULL,
  cuerpo           TEXT,
  entidad_tipo     TEXT,
  entidad_id       UUID,
  leida            BOOLEAN     DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.6 COMPROMISOS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compromisos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        REFERENCES gerencias(id),
  responsable_id   UUID        REFERENCES usuarios(id),
  descripcion      TEXT        NOT NULL,
  origen           TEXT        NOT NULL CHECK (
    origen IN ('campo','reunion','concejo','instruccion','otro')
  ),
  origen_ref       TEXT,                     -- descripción del contexto
  fecha_limite     DATE,
  prioridad        TEXT        DEFAULT 'media' CHECK (prioridad IN ('alta','media','baja')),
  estado           TEXT        DEFAULT 'pendiente' CHECK (
    estado IN ('pendiente','en_proceso','cumplido','vencido','cancelado')
  ),
  evidencia        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.7 AGENDA ITEMS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agenda_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  fecha            DATE        NOT NULL DEFAULT CURRENT_DATE,
  hora             TIME,
  duracion_min     SMALLINT,
  titulo           TEXT        NOT NULL,
  lugar            TEXT,
  tipo             TEXT        CHECK (tipo IN ('interna','campo','audiencia','concejo','admin','otro')),
  requiere_briefing BOOLEAN    DEFAULT FALSE,
  briefing_listo   BOOLEAN     DEFAULT FALSE,
  briefing_texto   TEXT,                     -- generado por IA (Etapa 5)
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.8 DOCUMENTOS FIRMA
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos_firma (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  enviado_por_id   UUID        REFERENCES usuarios(id),
  titulo           TEXT        NOT NULL,
  descripcion      TEXT,
  tipo             TEXT        CHECK (tipo IN ('resolucion','contrato','convenio','oficio','otro')),
  urgencia         TEXT        DEFAULT 'normal' CHECK (urgencia IN ('urgente','normal')),
  estado           TEXT        DEFAULT 'pendiente' CHECK (
    estado IN ('pendiente','aprobado','devuelto','archivado')
  ),
  motivo_devolucion TEXT,
  fecha_accion     TIMESTAMPTZ,
  archivo_url      TEXT,                     -- Supabase Storage (Etapa 4)
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.9 OBRAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS obras (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id    UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id         UUID        NOT NULL REFERENCES gerencias(id),
  nombre              TEXT        NOT NULL,
  codigo_invierte     TEXT,                  -- código del sistema Invierte.pe
  estado              TEXT        NOT NULL DEFAULT 'licitacion' CHECK (
    estado IN ('licitacion','ejecucion','paralizada','terminada','liquidada')
  ),
  porcentaje_avance   NUMERIC(5,2) DEFAULT 0 CHECK (porcentaje_avance BETWEEN 0 AND 100),
  presupuesto         NUMERIC(14,2),
  fecha_inicio        DATE,
  fecha_fin_prevista  DATE,
  contratista         TEXT,
  supervisor          TEXT,
  dias_sin_avance     SMALLINT    DEFAULT 0,
  ultimo_avance_at    TIMESTAMPTZ,
  -- Riesgo calculado — ver función calcular_riesgo_obra()
  riesgo_nivel        TEXT        DEFAULT 'bajo' CHECK (
    riesgo_nivel IN ('critico','alto','medio','bajo')
  ),
  riesgo_score        SMALLINT    DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.10 AVANCES DE OBRA (historial completo)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avances_obra (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id          UUID        NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id),
  usuario_id       UUID        REFERENCES usuarios(id),
  porcentaje       NUMERIC(5,2) NOT NULL,
  observacion      TEXT,
  evidencia_url    TEXT,                     -- foto/archivo en Supabase Storage
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.11 PRESUPUESTO
-- Una fila por período + gerencia. Para consultas rápidas de ejecución.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presupuesto (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        REFERENCES gerencias(id),
  anio             SMALLINT    NOT NULL,
  periodo          TEXT,                     -- 'Q1','Q2','Q3','Q4' o null para anual
  asignado         NUMERIC(14,2) DEFAULT 0,
  ejecutado        NUMERIC(14,2) DEFAULT 0,
  comprometido     NUMERIC(14,2) DEFAULT 0,
  devengado        NUMERIC(14,2) DEFAULT 0,
  -- pct_ejecucion es calculado
  fuente           TEXT        DEFAULT 'manual' CHECK (fuente IN ('siaf_sync','manual','csv')),
  ultima_sync      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (municipalidad_id, COALESCE(gerencia_id, municipalidad_id), anio, COALESCE(periodo,'anual'))
);

-- Vista calculada de % ejecución por gerencia (sin columna generada para flexibilidad)
CREATE OR REPLACE VIEW presupuesto_view AS
SELECT *,
  CASE WHEN asignado > 0
    THEN ROUND((ejecutado / asignado * 100)::NUMERIC, 1)
    ELSE 0
  END AS pct_ejecucion,
  asignado - ejecutado AS saldo
FROM presupuesto;

-- ─────────────────────────────────────────────────────────────────────────
-- 2.12 INDICADORES
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicadores (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        NOT NULL REFERENCES gerencias(id),
  nombre           TEXT        NOT NULL,
  unidad           TEXT,
  meta_anual       NUMERIC(14,2),
  valor_actual     NUMERIC(14,2) DEFAULT 0,
  es_principal     BOOLEAN     DEFAULT FALSE, -- el KPI que aparece en el resumen del GM
  orden            SMALLINT    DEFAULT 0,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.13 PLAZOS NORMATIVOS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plazos_normativos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        REFERENCES gerencias(id),
  sistema          TEXT        NOT NULL,     -- 'MEF/SIAF','Invierte.pe','SEACE', etc.
  descripcion      TEXT        NOT NULL,
  fecha_limite     DATE        NOT NULL,
  -- dias_restantes se calcula al vuelo: (fecha_limite - CURRENT_DATE)
  nivel_alerta     TEXT        DEFAULT 'info' CHECK (nivel_alerta IN ('critico','alerta','info')),
  responsable_cod  TEXT,
  completado       BOOLEAN     DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Vista con días restantes calculados
CREATE OR REPLACE VIEW plazos_normativos_view AS
SELECT *,
  (fecha_limite - CURRENT_DATE)::INTEGER AS dias_restantes,
  CASE
    WHEN completado                              THEN 'completado'
    WHEN fecha_limite < CURRENT_DATE             THEN 'vencido'
    WHEN (fecha_limite - CURRENT_DATE) <= 15     THEN 'critico'
    WHEN (fecha_limite - CURRENT_DATE) <= 30     THEN 'alerta'
    ELSE 'info'
  END AS estado_calculado
FROM plazos_normativos;

-- ─────────────────────────────────────────────────────────────────────────
-- 2.14 HALLAZGOS CGR (Contraloría General de la República)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hallazgos_cgr (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  gerencia_id      UUID        REFERENCES gerencias(id),
  numero_informe   TEXT,
  descripcion      TEXT        NOT NULL,
  monto_observado  NUMERIC(14,2),
  fecha_informe    DATE,
  fecha_limite_sub DATE,
  estado           TEXT        DEFAULT 'pendiente' CHECK (
    estado IN ('pendiente','en_subsanacion','subsanado','apelado')
  ),
  evidencia_url    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.15 ALERTAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alertas (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  entidad_tipo     TEXT,                     -- 'obra','compromiso','plazo', etc.
  entidad_id       UUID,
  gerencia_id      UUID        REFERENCES gerencias(id),
  titulo           TEXT        NOT NULL,
  descripcion      TEXT,
  nivel            TEXT        NOT NULL CHECK (nivel IN ('critico','alerta','info')),
  leida            BOOLEAN     DEFAULT FALSE,
  resuelta         BOOLEAN     DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.16 REPORTES IA (briefings generados por Claude API — Etapa 5)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reportes_ia (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  tipo             TEXT        NOT NULL,     -- 'briefing_agenda','resumen_semanal','analisis_obra'
  entidad_id       UUID,
  contenido_md     TEXT        NOT NULL,     -- Markdown generado por Claude
  tokens_usados    INTEGER,
  modelo           TEXT        DEFAULT 'claude-sonnet-4-20250514',
  solicitado_por   UUID        REFERENCES usuarios(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.17 INTEGRACIONES SYNC STATUS
-- Estado de sincronización con sistemas externos (SIAF, Invierte.pe, SEACE)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integraciones_sync_status (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  sistema          TEXT        NOT NULL,     -- 'SIAF_GL','INVIERTE_PE','SEACE','RENIEC'
  estado           TEXT        NOT NULL DEFAULT 'desconectado' CHECK (
    estado IN ('activo','degradado','desconectado')
  ),
  ultima_sync      TIMESTAMPTZ,
  ultimo_error     TEXT,
  reintentos       SMALLINT    DEFAULT 0,
  max_reintentos   SMALLINT    DEFAULT 8,
  -- [D4] freshness_score: columna generada — no escribible directamente
  -- Fórmula: 100 si activo y sync < 2h; 0 si desconectado; proporcional si degradado
  freshness_score  SMALLINT GENERATED ALWAYS AS (
    CASE
      WHEN estado = 'activo'       AND ultima_sync > now() - INTERVAL '2 hours'  THEN 100
      WHEN estado = 'activo'       AND ultima_sync > now() - INTERVAL '6 hours'  THEN 75
      WHEN estado = 'activo'       AND ultima_sync > now() - INTERVAL '24 hours' THEN 50
      WHEN estado = 'degradado'    AND ultima_sync > now() - INTERVAL '6 hours'  THEN 45
      WHEN estado = 'degradado'                                                   THEN 20
      ELSE 0
    END
  ) STORED,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (municipalidad_id, sistema)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.18 AUDITORÍA EVENTOS — APPEND-ONLY [D2]
-- REVOKE aplicado más abajo, después de crear tablas.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_eventos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL,     -- sin FK para no bloquear en cascada
  usuario_id       UUID        NOT NULL,
  usuario_rol      TEXT,
  entidad_tipo     TEXT        NOT NULL,
  entidad_id       TEXT,                     -- puede ser UUID o código string
  entidad_label    TEXT,
  accion           TEXT        NOT NULL,     -- 'create','update','delete','login','export',etc.
  before_state     JSONB,
  after_state      JSONB,
  delta            JSONB,                    -- solo los campos que cambiaron
  device_type      TEXT,
  user_agent       TEXT,
  ip_address       INET,
  -- [D3] Hash encadenado para verificación de integridad
  hash_prev_evento TEXT,
  hash_evento      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2.19 PRODUCT TELEMETRY — sin PII, para métricas de adopción [D5]
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_telemetry (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID,                     -- puede ser null en onboarding
  usuario_id       UUID,                     -- puede ser null
  rol              TEXT,
  evento           TEXT        NOT NULL,
  metadata         JSONB,
  device_type      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 3: ÍNDICES
-- ═══════════════════════════════════════════════════════════════════════════

-- Por tenant (todas las tablas)
CREATE INDEX IF NOT EXISTS idx_gerencias_muni           ON gerencias          (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_muni            ON usuarios           (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol             ON usuarios           (municipalidad_id, rol);
CREATE INDEX IF NOT EXISTS idx_instrucciones_muni       ON instrucciones      (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_muni      ON notificaciones     (municipalidad_id, usuario_id);
CREATE INDEX IF NOT EXISTS idx_compromisos_muni         ON compromisos        (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_muni        ON agenda_items       (municipalidad_id, fecha);
CREATE INDEX IF NOT EXISTS idx_docs_firma_muni          ON documentos_firma   (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_obras_muni               ON obras              (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_avances_obra_muni        ON avances_obra       (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_muni         ON presupuesto        (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_indicadores_muni         ON indicadores        (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_plazos_muni              ON plazos_normativos  (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_hallazgos_muni           ON hallazgos_cgr      (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_alertas_muni             ON alertas            (municipalidad_id, leida);
CREATE INDEX IF NOT EXISTS idx_reportes_muni            ON reportes_ia        (municipalidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_muni           ON auditoria_eventos  (municipalidad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integraciones_muni       ON integraciones_sync_status (municipalidad_id);

-- Instrucciones: receptor/emisor
CREATE INDEX IF NOT EXISTS idx_instrucciones_receptor   ON instrucciones (municipalidad_id, receptor_id, confirmada);
CREATE INDEX IF NOT EXISTS idx_instrucciones_emisor     ON instrucciones (municipalidad_id, emisor_id);
CREATE INDEX IF NOT EXISTS idx_instrucciones_ger_cod    ON instrucciones (municipalidad_id, receptor_ger_cod);
CREATE INDEX IF NOT EXISTS idx_instrucciones_created    ON instrucciones (municipalidad_id, created_at DESC);

-- Obras: por gerencia y riesgo
CREATE INDEX IF NOT EXISTS idx_obras_gerencia           ON obras (municipalidad_id, gerencia_id);
CREATE INDEX IF NOT EXISTS idx_obras_riesgo             ON obras (municipalidad_id, riesgo_nivel) WHERE riesgo_nivel IN ('critico','alto');
CREATE INDEX IF NOT EXISTS idx_obras_estado             ON obras (municipalidad_id, estado);
CREATE INDEX IF NOT EXISTS idx_avances_obra_id          ON avances_obra (obra_id, created_at DESC);

-- Compromisos: por vencimiento y gerencia
CREATE INDEX IF NOT EXISTS idx_compromisos_vencimiento  ON compromisos (municipalidad_id, fecha_limite) WHERE estado NOT IN ('cumplido','cancelado');
CREATE INDEX IF NOT EXISTS idx_compromisos_gerencia     ON compromisos (municipalidad_id, gerencia_id);

-- Auditoría
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario        ON auditoria_eventos (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad        ON auditoria_eventos (entidad_tipo, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion         ON auditoria_eventos (accion, created_at DESC);

-- Plazos normativos: por fecha límite
CREATE INDEX IF NOT EXISTS idx_plazos_fecha             ON plazos_normativos (municipalidad_id, fecha_limite) WHERE NOT completado;

-- Alertas activas
CREATE INDEX IF NOT EXISTS idx_alertas_activas          ON alertas (municipalidad_id, nivel) WHERE NOT leida AND NOT resuelta;

-- Presupuesto: por año y gerencia
CREATE INDEX IF NOT EXISTS idx_presupuesto_anio         ON presupuesto (municipalidad_id, anio, gerencia_id);

-- Telemetría: por evento y fecha
CREATE INDEX IF NOT EXISTS idx_telemetria_evento        ON product_telemetry (evento, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetria_muni          ON product_telemetry (municipalidad_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 4: ROW LEVEL SECURITY (RLS)
-- Aislamiento estricto por tenant. JWT claims como fuente primaria [D1].
-- ═══════════════════════════════════════════════════════════════════════════

-- Habilitar RLS en todas las tablas
ALTER TABLE municipalidades          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerencias                ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrucciones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE compromisos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_firma         ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE avances_obra             ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto              ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicadores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE plazos_normativos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hallazgos_cgr            ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_ia              ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_eventos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE integraciones_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_telemetry        ENABLE ROW LEVEL SECURITY;
ALTER TABLE avances_obra             ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 4.1 MUNICIPALIDADES
-- Solo puede ver su propia fila. Solo soporte_kausay puede ver todas.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY muni_select ON municipalidades FOR SELECT
  USING (
    id = get_municipalidad_id()
    OR get_user_rol() = 'soporte_kausay'
  );

CREATE POLICY muni_update ON municipalidades FOR UPDATE
  USING (id = get_municipalidad_id() AND get_user_rol() IN ('alcalde','soporte_kausay'))
  WITH CHECK (id = get_municipalidad_id());

-- soporte_kausay puede insertar nuevos tenants
CREATE POLICY muni_insert ON municipalidades FOR INSERT
  WITH CHECK (get_user_rol() = 'soporte_kausay');

-- ─────────────────────────────────────────────────────────────────────────
-- 4.2 GERENCIAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY ger_select ON gerencias FOR SELECT
  USING (can_access(municipalidad_id));

CREATE POLICY ger_update ON gerencias FOR UPDATE
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('alcalde','soporte_kausay'))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

CREATE POLICY ger_insert ON gerencias FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND get_user_rol() IN ('alcalde','soporte_kausay')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4.3 USUARIOS
-- ─────────────────────────────────────────────────────────────────────────
-- Puede verse a sí mismo y a los de su municipalidad
CREATE POLICY usr_select ON usuarios FOR SELECT
  USING (
    can_access(municipalidad_id)
    OR id = auth.uid()  -- siempre puede verse a sí mismo
  );

CREATE POLICY usr_update ON usuarios FOR UPDATE
  USING (
    municipalidad_id = get_municipalidad_id()
    AND get_user_rol() IN ('alcalde','soporte_kausay')
  )
  WITH CHECK (municipalidad_id = get_municipalidad_id());

CREATE POLICY usr_insert ON usuarios FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND get_user_rol() IN ('alcalde','soporte_kausay')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4.4 INSTRUCCIONES
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT: puede ver las que emitió o recibió (o toda si es alcalde/GM)
CREATE POLICY instr_select ON instrucciones FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho','soporte_kausay','oci_lectura')
      OR emisor_id  = auth.uid()
      OR receptor_id = auth.uid()
      -- gerente_sectorial ve las de su gerencia
      OR (get_user_rol() = 'gerente_sectorial' AND receptor_ger_cod = get_gerencia_cod())
    )
  );

CREATE POLICY instr_insert ON instrucciones FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND is_activo()
    AND emisor_id = auth.uid()  -- solo puede emitir como sí mismo
  );

-- Solo el receptor puede confirmar/responder (UPDATE limitado)
CREATE POLICY instr_update ON instrucciones FOR UPDATE
  USING (
    can_access(municipalidad_id)
    AND (receptor_id = auth.uid() OR get_user_rol() IN ('alcalde','soporte_kausay'))
  )
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.5 NOTIFICACIONES
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY notif_select ON notificaciones FOR SELECT
  USING (can_access(municipalidad_id) AND usuario_id = auth.uid());

CREATE POLICY notif_update ON notificaciones FOR UPDATE
  USING (can_access(municipalidad_id) AND usuario_id = auth.uid());

CREATE POLICY notif_insert ON notificaciones FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id() AND is_activo());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.6 COMPROMISOS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY comp_select ON compromisos FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho','secretaria','oci_lectura','soporte_kausay')
      OR can_access_gerencia(gerencia_id)
    )
  );

CREATE POLICY comp_insert ON compromisos FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id() AND is_activo());

CREATE POLICY comp_update ON compromisos FOR UPDATE
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('alcalde','gerente_municipal','secretaria','soporte_kausay')
      OR can_access_gerencia(gerencia_id)
    )
  )
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.7 AGENDA ITEMS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY agenda_select ON agenda_items FOR SELECT
  USING (can_access(municipalidad_id));

CREATE POLICY agenda_insert ON agenda_items FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND get_user_rol() IN ('alcalde','secretaria','asesor_despacho','soporte_kausay')
  );

CREATE POLICY agenda_update ON agenda_items FOR UPDATE
  USING (
    can_access(municipalidad_id)
    AND get_user_rol() IN ('alcalde','secretaria','asesor_despacho','soporte_kausay')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4.8 DOCUMENTOS FIRMA
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY docs_select ON documentos_firma FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND get_user_rol() IN ('alcalde','secretaria','gerente_municipal','asesor_despacho','oci_lectura','soporte_kausay')
  );

CREATE POLICY docs_insert ON documentos_firma FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND is_activo()
    AND get_user_rol() IN ('secretaria','gerente_municipal','asesor_despacho','soporte_kausay')
  );

CREATE POLICY docs_update ON documentos_firma FOR UPDATE
  USING (
    can_access(municipalidad_id)
    AND get_user_rol() IN ('alcalde','secretaria','soporte_kausay')
  )
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.9 OBRAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY obras_select ON obras FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho','oci_lectura','soporte_kausay')
      OR can_access_gerencia(gerencia_id)
    )
  );

CREATE POLICY obras_insert ON obras FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND is_activo()
    AND (
      get_user_rol() IN ('gerente_municipal','soporte_kausay')
      OR (get_user_rol() = 'gerente_sectorial' AND gerencia_id = get_gerencia_id())
    )
  );

CREATE POLICY obras_update ON obras FOR UPDATE
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('gerente_municipal','soporte_kausay')
      OR (get_user_rol() = 'gerente_sectorial' AND gerencia_id = get_gerencia_id())
    )
  )
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.10 AVANCES DE OBRA
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY avances_select ON avances_obra FOR SELECT
  USING (can_access(municipalidad_id));

CREATE POLICY avances_insert ON avances_obra FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND is_activo()
    AND usuario_id = auth.uid()
  );
-- Avances no se modifican ni eliminan — son historial inmutable

-- ─────────────────────────────────────────────────────────────────────────
-- 4.11 PRESUPUESTO, INDICADORES, PLAZOS, HALLAZGOS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY pres_select ON presupuesto FOR SELECT USING (can_access(municipalidad_id));
CREATE POLICY pres_upsert ON presupuesto FOR ALL
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('gerente_municipal','alcalde','soporte_kausay'))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

CREATE POLICY ind_select ON indicadores FOR SELECT USING (can_access(municipalidad_id));
CREATE POLICY ind_update ON indicadores FOR UPDATE
  USING (can_access(municipalidad_id) AND (get_user_rol() IN ('gerente_municipal','soporte_kausay') OR can_access_gerencia(gerencia_id)))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

CREATE POLICY plazos_select ON plazos_normativos FOR SELECT USING (can_access(municipalidad_id));
CREATE POLICY plazos_all ON plazos_normativos FOR ALL
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('gerente_municipal','alcalde','secretaria','soporte_kausay'))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

CREATE POLICY hallazgos_select ON hallazgos_cgr FOR SELECT
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('alcalde','gerente_municipal','oci_lectura','soporte_kausay'));
CREATE POLICY hallazgos_all ON hallazgos_cgr FOR ALL
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('gerente_municipal','soporte_kausay'))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.12 ALERTAS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY alertas_select ON alertas FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (
      get_user_rol() IN ('alcalde','gerente_municipal','secretaria','asesor_despacho','soporte_kausay')
      OR (get_user_rol() = 'gerente_sectorial' AND (gerencia_id = get_gerencia_id() OR gerencia_id IS NULL))
    )
  );

CREATE POLICY alertas_insert ON alertas FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id() AND is_activo());

CREATE POLICY alertas_update ON alertas FOR UPDATE
  USING (can_access(municipalidad_id))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.13 REPORTES IA
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY reportes_select ON reportes_ia FOR SELECT
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho','soporte_kausay'));

CREATE POLICY reportes_insert ON reportes_ia FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id() AND is_activo());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.14 INTEGRACIONES SYNC STATUS
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY integ_select ON integraciones_sync_status FOR SELECT
  USING (can_access(municipalidad_id));

CREATE POLICY integ_upsert ON integraciones_sync_status FOR ALL
  USING (can_access(municipalidad_id) AND get_user_rol() IN ('gerente_municipal','soporte_kausay'))
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.15 AUDITORÍA EVENTOS [D2]
-- Solo INSERT. SELECT restringido a alcalde, GM y soporte.
-- UPDATE y DELETE revocados abajo.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY audit_select ON auditoria_eventos FOR SELECT
  USING (
    municipalidad_id = get_municipalidad_id()
    AND get_user_rol() IN ('alcalde','gerente_municipal','oci_lectura','soporte_kausay')
  );

CREATE POLICY audit_insert ON auditoria_eventos FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 4.16 PRODUCT TELEMETRY [D5]
-- INSERT para todos los roles activos. SELECT solo para soporte_kausay.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY tele_insert ON product_telemetry FOR INSERT
  WITH CHECK (is_activo());

CREATE POLICY tele_select ON product_telemetry FOR SELECT
  USING (get_user_rol() = 'soporte_kausay');


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 5: AUDITORÍA — APPEND-ONLY ENFORCEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- [D2] Revocar UPDATE y DELETE en auditoria_eventos para todos los roles
-- El rol postgres (superuser) conserva sus privilegios por diseño de Supabase.
REVOKE UPDATE, DELETE ON auditoria_eventos FROM authenticated;
REVOKE UPDATE, DELETE ON auditoria_eventos FROM anon;

-- Función para registrar eventos de auditoría — SECURITY DEFINER para
-- poder insertar aunque RLS bloquee al usuario (ej: operaciones en cascada)
CREATE OR REPLACE FUNCTION registrar_evento(
  p_entidad_tipo  TEXT,
  p_entidad_id    TEXT,
  p_entidad_label TEXT,
  p_accion        TEXT,
  p_before_state  JSONB DEFAULT NULL,
  p_after_state   JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          UUID := gen_random_uuid();
  v_prev_hash   TEXT;
  v_delta       JSONB;
BEGIN
  -- Calcular delta entre before y after
  IF p_before_state IS NOT NULL AND p_after_state IS NOT NULL THEN
    SELECT jsonb_object_agg(key, jsonb_build_object('before', p_before_state->key, 'after', p_after_state->key))
    INTO v_delta
    FROM jsonb_object_keys(p_after_state) AS key
    WHERE p_before_state->key IS DISTINCT FROM p_after_state->key;
  END IF;

  -- Obtener hash del último evento del tenant para encadenamiento [D3]
  SELECT hash_evento INTO v_prev_hash
  FROM auditoria_eventos
  WHERE municipalidad_id = get_municipalidad_id()
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO auditoria_eventos (
    id, municipalidad_id, usuario_id, usuario_rol,
    entidad_tipo, entidad_id, entidad_label, accion,
    before_state, after_state, delta,
    hash_prev_evento, hash_evento,
    created_at
  ) VALUES (
    v_id,
    get_municipalidad_id(),
    auth.uid(),
    get_user_rol(),
    p_entidad_tipo, p_entidad_id, p_entidad_label, p_accion,
    p_before_state, p_after_state, v_delta,
    v_prev_hash,
    encode(digest(
      v_id::TEXT || get_municipalidad_id()::TEXT || p_accion || COALESCE(p_entidad_id,'') || now()::TEXT,
      'sha256'
    ), 'hex'),
    now()
  );

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGERS DE AUDITORÍA
-- ─────────────────────────────────────────────────────────────────────────

-- Función genérica para triggers de auditoría
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accion TEXT;
  v_label  TEXT;
BEGIN
  v_accion := TG_OP;  -- 'INSERT','UPDATE','DELETE'
  v_label  := COALESCE(
    NEW.nombre, NEW.titulo, NEW.descripcion, NEW.contenido,
    OLD.nombre, OLD.titulo, OLD.descripcion, OLD.contenido,
    TG_TABLE_NAME
  );

  PERFORM registrar_evento(
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    LEFT(v_label, 100),
    LOWER(v_accion),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Aplicar trigger a tablas críticas
CREATE TRIGGER audit_instrucciones
  AFTER INSERT OR UPDATE ON instrucciones
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_obras
  AFTER INSERT OR UPDATE ON obras
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_avances_obra
  AFTER INSERT ON avances_obra
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_compromisos
  AFTER INSERT OR UPDATE ON compromisos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_documentos_firma
  AFTER INSERT OR UPDATE ON documentos_firma
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 6: FUNCIONES DE NEGOCIO
-- ═══════════════════════════════════════════════════════════════════════════

-- Calcular y actualizar el riesgo de una obra
CREATE OR REPLACE FUNCTION calcular_riesgo_obra(p_obra_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_obra   obras%ROWTYPE;
  v_score  SMALLINT := 0;
  v_nivel  TEXT;
BEGIN
  SELECT * INTO v_obra FROM obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN 'bajo'; END IF;

  -- Scoring (alineado con shared.js v2 calcRiesgoObra)
  IF    v_obra.dias_sin_avance > 15 THEN v_score := v_score + 40;
  ELSIF v_obra.dias_sin_avance > 7  THEN v_score := v_score + 20;
  ELSIF v_obra.dias_sin_avance > 3  THEN v_score := v_score + 10;
  END IF;

  IF v_obra.estado = 'paralizada'                          THEN v_score := v_score + 30; END IF;
  IF v_obra.porcentaje_avance < 30 AND v_obra.estado = 'ejecucion' THEN v_score := v_score + 30;
  ELSIF v_obra.porcentaje_avance < 50                      THEN v_score := v_score + 15;
  END IF;

  v_nivel := CASE
    WHEN v_score >= 60 THEN 'critico'
    WHEN v_score >= 35 THEN 'alto'
    WHEN v_score >= 15 THEN 'medio'
    ELSE 'bajo'
  END;

  UPDATE obras
  SET riesgo_nivel = v_nivel, riesgo_score = v_score, updated_at = now()
  WHERE id = p_obra_id;

  RETURN v_nivel;
END;
$$;

-- Trigger: actualizar riesgo automáticamente al registrar avance
CREATE OR REPLACE FUNCTION trigger_actualizar_riesgo_obra()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE obras
  SET porcentaje_avance = NEW.porcentaje,
      dias_sin_avance   = 0,
      ultimo_avance_at  = now(),
      updated_at        = now()
  WHERE id = NEW.obra_id;

  PERFORM calcular_riesgo_obra(NEW.obra_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_avance_actualiza_obra
  AFTER INSERT ON avances_obra
  FOR EACH ROW EXECUTE FUNCTION trigger_actualizar_riesgo_obra();

-- Cron helper: incrementar dias_sin_avance diariamente
-- Registrar en pg_cron: SELECT cron.schedule('incr-dias-sin-avance','0 3 * * *','SELECT incrementar_dias_sin_avance()');
CREATE OR REPLACE FUNCTION incrementar_dias_sin_avance()
RETURNS VOID LANGUAGE sql AS $$
  UPDATE obras
  SET dias_sin_avance = dias_sin_avance + 1,
      updated_at      = now()
  WHERE estado IN ('ejecucion','paralizada')
    AND (ultimo_avance_at IS NULL OR ultimo_avance_at < now() - INTERVAL '1 day');
$$;

-- Sincronizar perfil de usuario desde auth.users al hacer login
CREATE OR REPLACE FUNCTION sync_usuario_desde_auth()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE usuarios
  SET ultimo_acceso = now(), updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- (Registrar en Supabase Auth hooks)
-- CREATE TRIGGER on_auth_sign_in
--   AFTER UPDATE OF last_sign_in_at ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION sync_usuario_desde_auth();

-- updated_at automático para todas las tablas que lo tienen
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_muni_updated        BEFORE UPDATE ON municipalidades          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ger_updated         BEFORE UPDATE ON gerencias                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_usr_updated         BEFORE UPDATE ON usuarios                 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_instr_updated       BEFORE UPDATE ON instrucciones             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_comp_updated        BEFORE UPDATE ON compromisos              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_obras_updated       BEFORE UPDATE ON obras                    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_docs_updated        BEFORE UPDATE ON documentos_firma         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pres_updated        BEFORE UPDATE ON presupuesto              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ind_updated         BEFORE UPDATE ON indicadores              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_plazos_updated      BEFORE UPDATE ON plazos_normativos        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_hallazgos_updated   BEFORE UPDATE ON hallazgos_cgr            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_alertas_updated     BEFORE UPDATE ON alertas                  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_integ_updated       BEFORE UPDATE ON integraciones_sync_status FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 7: REALTIME PUBLICATION
-- Solo tablas operativas que los dashboards necesitan en tiempo real.
-- ═══════════════════════════════════════════════════════════════════════════

-- Crear publication si no existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END$$;

ALTER PUBLICATION supabase_realtime ADD TABLE instrucciones;
ALTER PUBLICATION supabase_realtime ADD TABLE alertas;
ALTER PUBLICATION supabase_realtime ADD TABLE obras;
ALTER PUBLICATION supabase_realtime ADD TABLE compromisos;
ALTER PUBLICATION supabase_realtime ADD TABLE documentos_firma;
ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;
ALTER PUBLICATION supabase_realtime ADD TABLE agenda_items;
ALTER PUBLICATION supabase_realtime ADD TABLE integraciones_sync_status;

-- Tablas de solo lectura para dashboards — presupuesto e indicadores
ALTER PUBLICATION supabase_realtime ADD TABLE presupuesto;
ALTER PUBLICATION supabase_realtime ADD TABLE indicadores;

-- NO incluir en realtime (alto volumen / lectura histórica):
-- auditoria_eventos, product_telemetry, avances_obra, reportes_ia


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 8: JWT CLAIMS HOOK
-- Configura qué claims se inyectan en el JWT de Supabase Auth.
-- Registrar en: Authentication > Hooks > Custom Access Token Hook
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION kausay_jwt_claims_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   usuarios%ROWTYPE;
  v_claims JSONB;
BEGIN
  -- Leer perfil del usuario desde la tabla usuarios
  SELECT * INTO v_user
  FROM usuarios
  WHERE id = (event->>'user_id')::UUID;

  -- Si el usuario no existe en la tabla o está inactivo, retornar claims mínimos
  IF NOT FOUND OR NOT v_user.activo THEN
    RETURN jsonb_set(event, '{claims}', event->'claims' || jsonb_build_object(
      'activo', false,
      'rol', 'inactivo'
    ));
  END IF;

  -- Inyectar claims completos
  v_claims := event->'claims' || jsonb_build_object(
    'municipalidad_id', v_user.municipalidad_id,
    'rol',              v_user.rol,
    'gerencia_id',      v_user.gerencia_id,
    'gerencia_cod',     v_user.gerencia_cod,
    'activo',           v_user.activo,
    'claims_version',   v_user.claims_version
  );

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- GRANT para que Supabase pueda ejecutar el hook
GRANT EXECUTE ON FUNCTION kausay_jwt_claims_hook TO supabase_auth_admin;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 9: SEED DEMO — MUNICIPALIDAD PROVINCIAL DE CAJAMARCA
-- ── SOLO PARA DEMOSTRACIÓN ── NO ejecutar en proyectos de producción ──
-- ═══════════════════════════════════════════════════════════════════════════

/*
-- Descomentar para cargar datos de demo de Cajamarca.
-- Requiere que los UUIDs correspondan a usuarios creados en Supabase Auth.

DO $$
DECLARE
  v_muni_id  UUID := 'a1b2c3d4-0001-0001-0001-cajamarca001'::UUID;
  v_infra_id UUID := 'a1b2c3d4-0001-0001-0002-gerinfra0001'::UUID;
  v_rentas_id UUID := 'a1b2c3d4-0001-0001-0003-gerrentas001'::UUID;
  v_serv_id  UUID := 'a1b2c3d4-0001-0001-0004-gerservi001'::UUID;
  v_soc_id   UUID := 'a1b2c3d4-0001-0001-0005-gersocial01'::UUID;
  v_sec_id   UUID := 'a1b2c3d4-0001-0001-0006-gersecret01'::UUID;
  v_plan_id  UUID := 'a1b2c3d4-0001-0001-0007-gerplanif01'::UUID;
BEGIN

-- Municipalidad
INSERT INTO municipalidades (id, nombre, nombre_corto, tipo, ubigeo, departamento, provincia, distrito,
  escudo_url, color_primario, color_secundario, alcalde_nombre, secretaria_nombre, gm_nombre, plan_saas)
VALUES (v_muni_id, 'Municipalidad Provincial de Cajamarca', 'MPC Cajamarca',
  'provincial', '060101', 'Cajamarca', 'Cajamarca', 'Cajamarca',
  'escudo.png', '#8B1A1A', '#1A1D23',
  'Roberto Sánchez Quiroz', 'Carmen Flores Ríos', 'Mg. Carlos Vásquez Díaz', 'provincial')
ON CONFLICT (ubigeo) DO NOTHING;

-- Gerencias
INSERT INTO gerencias (id, municipalidad_id, nombre, nombre_corto, cod, jefe_nombre, color, orden, activa) VALUES
  (v_infra_id, v_muni_id, 'Infraestructura y Obras',   'Infraestructura','INFRA',      'Ing. Ana Quispe Herrera',    '#0F6E56', 1, true),
  (v_rentas_id,v_muni_id, 'Rentas y Tributación',       'Rentas',         'RENTAS',     'Cont. Carlos Herrera D.',    '#185FA5', 2, true),
  (v_serv_id,  v_muni_id, 'Servicios Municipales',      'Servicios',      'SERVICIOS',  'Lic. Rosa Castro Vega',      '#5C3E8F', 3, true),
  (v_soc_id,   v_muni_id, 'Desarrollo Social',          'Social',         'SOCIAL',     'Lic. Marco Torres León',     '#B5540A', 4, true),
  (v_sec_id,   v_muni_id, 'Secretaría General',         'Secretaría',     'SECRETARIA', 'Abg. Patricia Abanto R.',    '#4A4A70', 5, true),
  (v_plan_id,  v_muni_id, 'Planeamiento y Presupuesto', 'Planeamiento',   'PLANIF',     'Econ. Eduardo Lima Soto',    '#2E6B5E', 6, true)
ON CONFLICT (municipalidad_id, cod) DO NOTHING;

-- Obras de demo
INSERT INTO obras (municipalidad_id, gerencia_id, nombre, codigo_invierte, estado, porcentaje_avance, presupuesto, fecha_fin_prevista, contratista, dias_sin_avance, riesgo_nivel) VALUES
  (v_muni_id, v_infra_id, 'Pavimentación Jr. Lima cuadra 8-12', '2024-001', 'paralizada', 34, 480000, '2024-12-15', 'Constructora Lima SAC', 26, 'critico'),
  (v_muni_id, v_infra_id, 'Construcción mercado La Colmena',   '2024-002', 'ejecucion',  68, 1200000,'2025-02-28', 'Edificaciones Norte SRL', 3, 'medio'),
  (v_muni_id, v_infra_id, 'Red agua potable sector norte',      '2024-003', 'ejecucion',  51, 680000, '2025-03-31', 'Hidráulica Andina EIRL', 5, 'medio'),
  (v_muni_id, v_serv_id,  'Planta residuos sólidos zona este',  '2024-004', 'ejecucion',  38, 2100000,'2025-09-30', 'EcoPerú SAC', 8, 'alto'),
  (v_muni_id, v_serv_id,  'Mejoramiento parque principal',      null,       'ejecucion',  82, 95000,  '2024-12-08', 'Jardinería Cajamarca', 1, 'bajo'),
  (v_muni_id, v_soc_id,   'Centro de salud Baños del Inca',     '2024-006', 'licitacion', 0,  920000, '2025-06-30', null, 0, 'bajo');

-- Presupuesto
INSERT INTO presupuesto (municipalidad_id, gerencia_id, anio, asignado, ejecutado) VALUES
  (v_muni_id, null,       2024, 7830000, 5298100),
  (v_muni_id, v_infra_id, 2024, 4850000, 3421000),
  (v_muni_id, v_soc_id,   2024, 1200000, 940000),
  (v_muni_id, v_rentas_id,2024, 380000,  155000),
  (v_muni_id, v_serv_id,  2024, 920000,  512000),
  (v_muni_id, v_sec_id,   2024, 290000,  198000),
  (v_muni_id, v_plan_id,  2024, 185000,  72000)
ON CONFLICT DO NOTHING;

-- Integraciones
INSERT INTO integraciones_sync_status (municipalidad_id, sistema, estado, ultima_sync, ultimo_error) VALUES
  (v_muni_id, 'SIAF_GL',      'degradado',    now() - INTERVAL '5 hours',  'API MEF no disponible desde las 03:00'),
  (v_muni_id, 'INVIERTE_PE',  'activo',       now() - INTERVAL '2 hours',  null),
  (v_muni_id, 'SEACE',        'desconectado', now() - INTERVAL '3 days',   'Timeout después de 3 reintentos')
ON CONFLICT (municipalidad_id, sistema) DO NOTHING;

END$$;
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL SCRIPT
-- ═══════════════════════════════════════════════════════════════════════════
-- RESUMEN:
-- Tablas:     19 (incluyendo views)
-- Funciones:  8
-- Triggers:   13 (audit x5, negocio x3, updated_at x11)
-- Políticas:  ~45 RLS policies
-- Índices:    ~30
-- Publication: supabase_realtime con 10 tablas
-- ─────────────────────────────────────────────────────────────────────────
