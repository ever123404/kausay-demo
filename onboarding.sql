-- ═══════════════════════════════════════════════════════════════════════════
-- KAUSAY MUNICIPAL — onboarding.sql v1.0
-- Activación de nueva municipalidad en producción
-- ─────────────────────────────────────────────────────────────────────────
-- INSTRUCCIONES DE USO:
-- 1. Sustituir TODAS las variables {{VARIABLE}} con los datos reales
-- 2. Ejecutar en el SQL editor de Supabase con rol postgres
-- 3. Los usuarios deben crearse en Supabase Auth ANTES de ejecutar
--    la sección de usuarios (se necesita el auth.uid de cada uno)
-- 4. Verificar con el smoke test después de completar
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 1: MUNICIPALIDAD
-- Sustituir variables con los datos reales de la municipalidad piloto
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO municipalidades (
  id, nombre, nombre_corto, tipo, ubigeo,
  departamento, provincia, distrito,
  escudo_url, color_primario, color_secundario,
  alcalde_nombre, secretaria_nombre, gm_nombre,
  plan_saas, activo, onboarding_done
) VALUES (
  gen_random_uuid(),          -- id auto
  '{{NOMBRE_OFICIAL}}',       -- ej: 'Municipalidad Distrital de Baños del Inca'
  '{{NOMBRE_CORTO}}',         -- ej: 'MDI Baños del Inca'
  '{{TIPO}}',                 -- 'distrital' | 'provincial' | 'metropolitana'
  '{{UBIGEO}}',               -- ej: '060102'
  '{{DEPARTAMENTO}}',         -- ej: 'Cajamarca'
  '{{PROVINCIA}}',            -- ej: 'Cajamarca'
  '{{DISTRITO}}',             -- ej: 'Baños del Inca'
  'escudo.png',               -- URL del escudo (actualizar después del upload)
  '{{COLOR_PRIMARIO}}',       -- ej: '#1A4A7A' (color institucional hex)
  '#1A1D23',                  -- color secundario (sidebar)
  '{{ALCALDE_NOMBRE}}',       -- nombre completo del alcalde
  '{{SECRETARIA_NOMBRE}}',    -- nombre de la secretaria
  '{{GM_NOMBRE}}',            -- nombre y título del gerente municipal
  '{{PLAN_SAAS}}',            -- 'distrital' | 'provincial' | 'metropolitana'
  TRUE,
  FALSE  -- onboarding_done = false hasta completar el proceso
)
RETURNING id AS municipalidad_id;

-- GUARDAR EL ID GENERADO para los pasos siguientes:
-- \set MUNI_ID (SELECT id FROM municipalidades WHERE ubigeo = '{{UBIGEO}}')

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 2: GERENCIAS BASE
-- Ajustar códigos, nombres y colores según la estructura real de la muni
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_muni_id UUID := (SELECT id FROM municipalidades WHERE ubigeo = '{{UBIGEO}}');
BEGIN
  -- Gerencias estándar para municipalidad distrital/provincial
  -- Adaptar según organigrama real: agregar, quitar o renombrar gerencias
  INSERT INTO gerencias (municipalidad_id, nombre, nombre_corto, cod, jefe_nombre, color, orden, activa) VALUES
    (v_muni_id, 'Gerencia de Infraestructura y Obras',     'Infraestructura',  'INFRA',      '{{JEFE_INFRA}}',      '#0F6E56', 1, TRUE),
    (v_muni_id, 'Gerencia de Rentas y Tributación',        'Rentas',           'RENTAS',     '{{JEFE_RENTAS}}',     '#185FA5', 2, TRUE),
    (v_muni_id, 'Gerencia de Servicios Municipales',       'Servicios',        'SERVICIOS',  '{{JEFE_SERVICIOS}}',  '#5C3E8F', 3, TRUE),
    (v_muni_id, 'Gerencia de Desarrollo Social',           'Social',           'SOCIAL',     '{{JEFE_SOCIAL}}',     '#B5540A', 4, TRUE),
    (v_muni_id, 'Secretaría General',                      'Secretaría',       'SECRETARIA', '{{JEFE_SECRETARIA}}', '#4A4A70', 5, TRUE),
    (v_muni_id, 'Gerencia de Planeamiento y Presupuesto',  'Planeamiento',     'PLANIF',     '{{JEFE_PLANIF}}',     '#2E6B5E', 6, TRUE)
  ON CONFLICT (municipalidad_id, cod) DO NOTHING;

  -- Presupuesto anual inicial (actualizar con cifras reales de SIAF)
  INSERT INTO presupuesto (municipalidad_id, gerencia_id, anio, asignado, ejecutado, fuente) VALUES
    (v_muni_id, NULL, EXTRACT(YEAR FROM CURRENT_DATE)::INT,
     {{PRESUPUESTO_TOTAL}},     -- ej: 4500000
     {{PRESUPUESTO_EJECUTADO}}, -- ej: 2100000
     'manual')
  ON CONFLICT DO NOTHING;

  -- Plazos normativos estándar (MEF, Invierte.pe, Contraloría)
  INSERT INTO plazos_normativos (municipalidad_id, sistema, descripcion, fecha_limite, nivel_alerta, responsable_cod) VALUES
    (v_muni_id, 'MEF/SIAF',    'Devengado 4to trimestre',        '{{ANIO}}-12-31', 'critico', 'PLANIF'),
    (v_muni_id, 'Invierte.pe', 'Actualización de avances PIP',   '{{ANIO}}-12-20', 'alerta',  'INFRA'),
    (v_muni_id, 'Contraloría', 'Rendición de cuentas anual',     '{{ANIO}}-03-31', 'info',    'PLANIF')
  ON CONFLICT DO NOTHING;

  -- Integrations iniciales (desconectadas hasta configurar API keys)
  INSERT INTO integraciones_sync_status (municipalidad_id, sistema, estado, ultimo_error) VALUES
    (v_muni_id, 'SIAF_GL',      'desconectado', 'Pendiente configuración de credenciales MEF'),
    (v_muni_id, 'INVIERTE_PE',  'desconectado', 'Pendiente configuración'),
    (v_muni_id, 'SEACE',        'desconectado', 'Pendiente configuración')
  ON CONFLICT (municipalidad_id, sistema) DO NOTHING;

  RAISE NOTICE 'Gerencias y datos base creados para municipalidad %', v_muni_id;
END$$;

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 3: USUARIOS BASE
-- PREREQUISITO: Crear usuarios en Supabase Auth Dashboard PRIMERO:
--   Authentication > Users > Add user (email + contraseña temporal)
-- Copiar los UUIDs generados por Supabase Auth aquí.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_muni_id   UUID := (SELECT id FROM municipalidades WHERE ubigeo = '{{UBIGEO}}');
  v_infra_id  UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='INFRA');
  v_rentas_id UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='RENTAS');
  v_serv_id   UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='SERVICIOS');
  v_soc_id    UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='SOCIAL');
  v_sec_id    UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='SECRETARIA');
  v_plan_id   UUID := (SELECT id FROM gerencias WHERE municipalidad_id=v_muni_id AND cod='PLANIF');
BEGIN
  -- REEMPLAZAR TODOS LOS '{{UUID_*}}' con los IDs reales de Supabase Auth
  INSERT INTO usuarios (id, municipalidad_id, email, nombre, rol, activo, mfa_habilitado, claims_version) VALUES
    -- Alcalde (MFA obligatorio — se completará en primer login)
    ('{{UUID_ALCALDE}}'::UUID,     v_muni_id, '{{EMAIL_ALCALDE}}',     '{{NOMBRE_ALCALDE}}',     'alcalde',           TRUE, FALSE, 0),
    -- Secretaria
    ('{{UUID_SECRETARIA}}'::UUID,  v_muni_id, '{{EMAIL_SECRETARIA}}',  '{{NOMBRE_SECRETARIA}}',  'secretaria',        TRUE, FALSE, 0),
    -- Gerente Municipal (MFA obligatorio)
    ('{{UUID_GM}}'::UUID,          v_muni_id, '{{EMAIL_GM}}',          '{{NOMBRE_GM}}',          'gerente_municipal', TRUE, FALSE, 0),
    -- Gerentes sectoriales
    ('{{UUID_INFRA}}'::UUID,       v_muni_id, '{{EMAIL_INFRA}}',       '{{NOMBRE_INFRA}}',       'gerente_sectorial', TRUE, FALSE, 0),
    ('{{UUID_RENTAS}}'::UUID,      v_muni_id, '{{EMAIL_RENTAS}}',      '{{NOMBRE_RENTAS}}',      'gerente_sectorial', TRUE, FALSE, 0),
    ('{{UUID_SERVICIOS}}'::UUID,   v_muni_id, '{{EMAIL_SERVICIOS}}',   '{{NOMBRE_SERVICIOS}}',   'gerente_sectorial', TRUE, FALSE, 0),
    ('{{UUID_SOCIAL}}'::UUID,      v_muni_id, '{{EMAIL_SOCIAL}}',      '{{NOMBRE_SOCIAL}}',      'gerente_sectorial', TRUE, FALSE, 0),
    ('{{UUID_SECRETARIA_G}}'::UUID,v_muni_id, '{{EMAIL_SECRETARIA_G}}','{{NOMBRE_SECRETARIA_G}}','gerente_sectorial', TRUE, FALSE, 0),
    ('{{UUID_PLANIF}}'::UUID,      v_muni_id, '{{EMAIL_PLANIF}}',      '{{NOMBRE_PLANIF}}',      'gerente_sectorial', TRUE, FALSE, 0)
  ON CONFLICT (id) DO UPDATE SET
    municipalidad_id = EXCLUDED.municipalidad_id,
    nombre           = EXCLUDED.nombre,
    rol              = EXCLUDED.rol,
    activo           = EXCLUDED.activo;

  -- Asociar gerentes sectoriales a sus gerencias
  UPDATE usuarios SET gerencia_id=v_infra_id,  gerencia_cod='INFRA'      WHERE id='{{UUID_INFRA}}'::UUID;
  UPDATE usuarios SET gerencia_id=v_rentas_id, gerencia_cod='RENTAS'     WHERE id='{{UUID_RENTAS}}'::UUID;
  UPDATE usuarios SET gerencia_id=v_serv_id,   gerencia_cod='SERVICIOS'  WHERE id='{{UUID_SERVICIOS}}'::UUID;
  UPDATE usuarios SET gerencia_id=v_soc_id,    gerencia_cod='SOCIAL'     WHERE id='{{UUID_SOCIAL}}'::UUID;
  UPDATE usuarios SET gerencia_id=v_sec_id,    gerencia_cod='SECRETARIA' WHERE id='{{UUID_SECRETARIA_G}}'::UUID;
  UPDATE usuarios SET gerencia_id=v_plan_id,   gerencia_cod='PLANIF'     WHERE id='{{UUID_PLANIF}}'::UUID;

  RAISE NOTICE 'Usuarios base creados para municipalidad %', v_muni_id;
END$$;

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 4: MARCAR ONBOARDING COMPLETADO
-- Ejecutar solo después de verificar que todo está correcto
-- ─────────────────────────────────────────────────────────────────────────
-- UPDATE municipalidades SET onboarding_done = TRUE WHERE ubigeo = '{{UBIGEO}}';

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 5: VERIFICACIÓN POST-ONBOARDING
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  m.nombre,
  m.tipo,
  m.ubigeo,
  m.plan_saas,
  m.onboarding_done,
  (SELECT COUNT(*) FROM gerencias WHERE municipalidad_id=m.id) AS gerencias,
  (SELECT COUNT(*) FROM usuarios  WHERE municipalidad_id=m.id) AS usuarios,
  (SELECT COUNT(*) FROM presupuesto WHERE municipalidad_id=m.id AND anio=EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS filas_presupuesto
FROM municipalidades m
WHERE m.ubigeo = '{{UBIGEO}}';

COMMIT;
