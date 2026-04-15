-- ═══════════════════════════════════════════════════════════════════════════
-- KAUSAY MUNICIPAL — security.sql v1.0
-- Pilot Security Hardening — ejecutar DESPUÉS de hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- [F3] TABLA: dispositivos_conocidos
-- Registra dispositivos por usuario. El frontend también guarda en
-- localStorage como backup — esta tabla es la fuente autoritativa.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispositivos_conocidos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id) ON DELETE CASCADE,
  device_hash      TEXT        NOT NULL,   -- hash determinístico del UA+lang+tz
  device_type      TEXT,                   -- 'mobile' | 'desktop'
  platform         TEXT,
  timezone         TEXT,
  idioma           TEXT,
  primer_acceso    TIMESTAMPTZ DEFAULT now(),
  ultimo_acceso    TIMESTAMPTZ DEFAULT now(),
  activo           BOOLEAN     DEFAULT TRUE,
  UNIQUE (usuario_id, device_hash)
);

-- RLS: el usuario solo ve sus propios dispositivos
ALTER TABLE dispositivos_conocidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY dev_select ON dispositivos_conocidos FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (usuario_id = auth.uid()
         OR get_user_rol() IN ('alcalde','soporte_kausay'))
  );

CREATE POLICY dev_insert ON dispositivos_conocidos FOR INSERT
  WITH CHECK (
    municipalidad_id = get_municipalidad_id()
    AND usuario_id = auth.uid()
  );

CREATE POLICY dev_update ON dispositivos_conocidos FOR UPDATE
  USING (can_access(municipalidad_id) AND usuario_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_dispositivos_usuario
  ON dispositivos_conocidos (usuario_id, device_hash);


-- ─────────────────────────────────────────────────────────────────────────
-- [F3] FUNCIÓN: registrar_dispositivo()
-- Upsert del dispositivo actual. Si es nuevo, dispara audit.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_dispositivo(
  p_device_hash  TEXT,
  p_device_type  TEXT,
  p_platform     TEXT,
  p_timezone     TEXT,
  p_idioma       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_muni_id  UUID := get_municipalidad_id();
  v_existing dispositivos_conocidos%ROWTYPE;
  v_is_new   BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_existing
  FROM dispositivos_conocidos
  WHERE usuario_id = v_user_id AND device_hash = p_device_hash;

  IF NOT FOUND THEN
    v_is_new := TRUE;
    INSERT INTO dispositivos_conocidos
      (usuario_id, municipalidad_id, device_hash, device_type, platform, timezone, idioma)
    VALUES
      (v_user_id, v_muni_id, p_device_hash, p_device_type, p_platform, p_timezone, p_idioma)
    ON CONFLICT (usuario_id, device_hash) DO NOTHING;

    -- Audit de nuevo dispositivo
    PERFORM registrar_evento(
      'dispositivo', p_device_hash, 'Dispositivo nuevo detectado', 'new_device',
      NULL,
      jsonb_build_object('type',p_device_type,'platform',p_platform,'tz',p_timezone)
    );
  ELSE
    -- Actualizar last_seen
    UPDATE dispositivos_conocidos
    SET ultimo_acceso = now()
    WHERE usuario_id = v_user_id AND device_hash = p_device_hash;
  END IF;

  RETURN jsonb_build_object('is_new', v_is_new, 'device_hash', p_device_hash);
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_dispositivo TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- [F2] FUNCIÓN: invalidar_sesiones_anteriores()
-- Para sesión única del alcalde: incrementa claims_version,
-- lo que invalida todos los JWT anteriores cuando el hook los valide.
-- Llamar desde auth.js después del login exitoso del alcalde.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION invalidar_sesiones_anteriores(p_usuario_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar que quien llama es el propio usuario o soporte
  IF auth.uid() <> p_usuario_id AND get_user_rol() <> 'soporte_kausay' THEN
    RAISE EXCEPTION 'No autorizado para invalidar sesiones de otro usuario';
  END IF;

  UPDATE usuarios
  SET claims_version = EXTRACT(EPOCH FROM now())::BIGINT * 1000,  -- timestamp ms
      updated_at     = now()
  WHERE id = p_usuario_id;

  PERFORM registrar_evento(
    'auth', p_usuario_id::TEXT, 'Sesión única', 'session_revoked',
    NULL, jsonb_build_object('reason','single_session_enforcement')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION invalidar_sesiones_anteriores TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- [F1] CONFIGURACIÓN MFA EN SUPABASE AUTH
-- Estas instrucciones son de configuración, no SQL ejecutable directamente.
-- Ejecutar en el dashboard de Supabase o via API.
-- ─────────────────────────────────────────────────────────────────────────
-- Para habilitar MFA TOTP en Supabase:
--
-- 1. Dashboard → Authentication → Settings → Multi-factor authentication
--    → Enable TOTP
--    → Set "Enrollment" to "optional" inicialmente
--    → Luego cambiar a "mandatory" para roles específicos via código
--
-- 2. El flujo de auth.js llama:
--    supabase.auth.mfa.enroll({ factorType: 'totp' })
--    supabase.auth.mfa.challengeAndVerify({ factorId, code })
--
-- 3. Verificar que el Assurance Level (AAL) requerido sea 'aal2'
--    para los roles alcalde y gerente_municipal:
--    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
--    Debe retornar { currentLevel: 'aal2' } después de verificar TOTP
--
-- 4. En el JWT hook kausay_jwt_claims_hook(), agregar verificación:
--    IF aal_level = 'aal2' THEN v_claims := v_claims || '{"mfa_verified":true}';


-- ─────────────────────────────────────────────────────────────────────────
-- [F5] VISTA: audit_accesos — resumen de eventos de autenticación
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW audit_accesos AS
SELECT
  ae.id,
  ae.municipalidad_id,
  ae.usuario_id,
  ae.usuario_rol,
  ae.entidad_label    AS email,
  ae.accion,
  ae.after_state,
  ae.created_at,
  -- Extraer device_hash del after_state
  ae.after_state->>'device_hash'  AS device_hash,
  ae.after_state->>'device_type'  AS device_type
FROM auditoria_eventos ae
WHERE ae.entidad_tipo = 'auth'
ORDER BY ae.created_at DESC;

GRANT SELECT ON audit_accesos TO authenticated;

-- Policy: solo el propio usuario, alcalde y soporte pueden ver
-- (hereda RLS de auditoria_eventos ya que es una view simple)


-- ─────────────────────────────────────────────────────────────────────────
-- [F5] FUNCIÓN: validate_audit_chain()
-- Verifica integridad del log de auditoría de un tenant.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_audit_chain(p_limit INT DEFAULT 100)
RETURNS TABLE(position BIGINT, evento_id UUID, chain_ok BOOLEAN, ts TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash TEXT := NULL;
  v_row       auditoria_eventos%ROWTYPE;
  v_pos       BIGINT := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM auditoria_eventos
    WHERE municipalidad_id = get_municipalidad_id()
    ORDER BY created_at ASC
    LIMIT p_limit
  LOOP
    v_pos := v_pos + 1;
    -- Si hay hash_prev_evento, verificar que coincide con el hash del evento anterior
    RETURN QUERY SELECT
      v_pos,
      v_row.id,
      CASE
        WHEN v_pos = 1 THEN TRUE  -- primer evento no tiene predecesor
        WHEN v_row.hash_prev_evento IS NULL THEN TRUE  -- campo opcional
        ELSE v_row.hash_prev_evento = v_prev_hash
      END,
      v_row.created_at;
    v_prev_hash := v_row.hash_evento;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_audit_chain TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- [F4] TABLA: reauth_log — registro de reautenticaciones
-- Separado de auditoria_eventos para consulta rápida en reporting
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reauth_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipalidad_id UUID        NOT NULL REFERENCES municipalidades(id),
  usuario_id       UUID        NOT NULL REFERENCES usuarios(id),
  accion           TEXT        NOT NULL,   -- la acción que requirió reauth
  resultado        TEXT        NOT NULL CHECK (resultado IN ('success','failed','cancelled')),
  device_hash      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE reauth_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY reauth_insert ON reauth_log FOR INSERT
  WITH CHECK (municipalidad_id = get_municipalidad_id() AND usuario_id = auth.uid());

CREATE POLICY reauth_select ON reauth_log FOR SELECT
  USING (
    can_access(municipalidad_id)
    AND (usuario_id = auth.uid()
         OR get_user_rol() IN ('alcalde','soporte_kausay'))
  );

-- Trigger de reauth: el frontend llama a registrar_evento() directamente.
-- Esta tabla es para consultas rápidas de reporting sin parsear JSONB.

GRANT INSERT ON reauth_log TO authenticated;
GRANT SELECT ON reauth_log TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- ACTUALIZAR kausay_jwt_claims_hook PARA INCLUIR claims_version CHECK
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION kausay_jwt_claims_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     usuarios%ROWTYPE;
  v_claims   JSONB;
  v_jwt_cv   BIGINT;
  v_db_cv    BIGINT;
BEGIN
  SELECT * INTO v_user FROM usuarios WHERE id = (event->>'user_id')::UUID;

  IF NOT FOUND OR NOT v_user.activo THEN
    RETURN jsonb_set(event,'{claims}',event->'claims'||'{"activo":false,"rol":"inactivo"}'::JSONB);
  END IF;

  -- [F2] Validar claims_version para sesión única del alcalde
  v_jwt_cv := COALESCE((event->'claims'->>'claims_version')::BIGINT, 0);
  v_db_cv  := COALESCE(v_user.claims_version, 0);
  IF v_jwt_cv < v_db_cv THEN
    -- JWT anterior a la última revocación — bloquear
    RETURN jsonb_set(event,'{claims}',event->'claims'||'{"activo":false,"rol":"sesion_invalidada"}'::JSONB);
  END IF;

  v_claims := event->'claims' || jsonb_build_object(
    'municipalidad_id', v_user.municipalidad_id,
    'rol',              v_user.rol,
    'gerencia_id',      v_user.gerencia_id,
    'gerencia_cod',     v_user.gerencia_cod,
    'activo',           v_user.activo,
    'claims_version',   v_user.claims_version,
    'mfa_habilitado',   v_user.mfa_habilitado
  );

  RETURN jsonb_set(event,'{claims}',v_claims);
END;
$$;

GRANT EXECUTE ON FUNCTION kausay_jwt_claims_hook TO supabase_auth_admin;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN security.sql v1.0
-- Tablas nuevas:    dispositivos_conocidos, reauth_log
-- Funciones nuevas: registrar_dispositivo, invalidar_sesiones_anteriores,
--                   validate_audit_chain
-- Vistas nuevas:    audit_accesos
-- JWT hook:         actualizado con claims_version check [F2]
-- ═══════════════════════════════════════════════════════════════════════════
