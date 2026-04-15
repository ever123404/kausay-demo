# Kausay Municipal — Checklist de Onboarding
## Activación de nueva municipalidad en producción
### Tiempo estimado: 4-8 horas (técnico + autoridades)

---

## PRE-REQUISITOS (antes del día de activación)

- [ ] Proyecto Supabase creado (plan Pro para pg_cron)
- [ ] `supabase-setup.sql` ejecutado
- [ ] `hardening.sql` ejecutado
- [ ] `security.sql` ejecutado
- [ ] Variables de entorno en Cloudflare Pages configuradas:
  - `__KAUSAY_SUPABASE_URL__`
  - `__KAUSAY_SUPABASE_KEY__`
  - `__KAUSAY_USE_SUPABASE__` = `true`
- [ ] Dominio personalizado activo (HTTPS obligatorio)
- [ ] MFA TOTP habilitado en Supabase Auth Dashboard

---

## DÍA DE ACTIVACIÓN

### BLOQUE 1 — Datos institucionales (30 min)

- [ ] Recopilar: nombre oficial, ubigeo, color primario, escudo en PNG fondo transparente
- [ ] Recopilar: nombre completo del alcalde, secretaria, GM y 6 gerentes sectoriales
- [ ] Recopilar: correos institucionales de cada usuario
- [ ] Recopilar: presupuesto anual total y ejecutado a la fecha (desde SIAF)
- [ ] Recopilar: 3-5 obras en ejecución con % avance real

### BLOQUE 2 — SQL inicial (45 min)

- [ ] Completar todas las variables `{{VARIABLE}}` en `onboarding.sql`
- [ ] Crear usuarios en Supabase Auth (Authentication > Users) con contraseñas temporales
- [ ] Copiar UUIDs generados por Supabase Auth al `onboarding.sql`
- [ ] Ejecutar `onboarding.sql` en SQL Editor de Supabase
- [ ] Verificar query de verificación final (5 columnas OK)
- [ ] Subir escudo.png a Supabase Storage → bucket `public/escudos/{{UBIGEO}}.png`
- [ ] Actualizar `escudo_url` en `municipalidades`: `UPDATE municipalidades SET escudo_url='https://...supabase.../escudos/{{UBIGEO}}.png' WHERE ubigeo='{{UBIGEO}}'`

### BLOQUE 3 — Ingresar datos base en config.html (30 min)

- [ ] Ingresar como `soporte_kausay` o `alcalde` a `config.html`
- [ ] Verificar sección "Identidad institucional" — todos los campos pre-cargados
- [ ] Ajustar nombre corto, tipo, ubicación si hay diferencias
- [ ] Verificar colores — vista previa debe mostrar la paleta correcta
- [ ] Ajustar nombres y jefes de gerencias si difieren del SQL
- [ ] Guardar (requiere reauth)
- [ ] Verificar en `index.html` que el branding es correcto

### BLOQUE 4 — Obras y presupuesto inicial (30 min)

- [ ] Ingresar obras reales desde `gerente.html` (cada gerente ingresa las suyas)
  O cargar via SQL directo si el tiempo no alcanza:
  ```sql
  INSERT INTO obras (municipalidad_id, gerencia_id, nombre, estado, porcentaje_avance, presupuesto, fecha_fin_prevista) VALUES (...);
  ```
- [ ] Actualizar presupuesto ejecutado en `presupuesto` table
- [ ] Verificar en `gm.html` que semáforo de gerencias es correcto

### BLOQUE 5 — Primer login de autoridades (60-90 min)

**Alcalde:**
- [ ] Alcalde abre `login.html` en su teléfono
- [ ] Ingresa correo institucional + contraseña temporal
- [ ] Sistema redirige a enrollamiento MFA — alcalde instala Google Authenticator
- [ ] Escanea QR / ingresa código → activa MFA
- [ ] Verifica que puede ver `alcalde.html` con datos reales
- [ ] Alcalde cambia su contraseña temporal (Supabase Auth)

**GM:**
- [ ] GM repite el flujo de MFA (obligatorio para gerente_municipal)
- [ ] Verifica `gm.html` con semáforo correcto

**Secretaria y gerentes:**
- [ ] Login normal (sin MFA obligatorio en piloto)
- [ ] Cada gerente verifica que ve SOLO su gerencia en `gerente.html`
- [ ] Secretaria verifica `secretaria.html`

### BLOQUE 6 — Verificación final (30 min)

- [ ] Abrir consola del browser en `alcalde.html` y ejecutar `smoke_test.js`
  → Resultado esperado: 0 fallos
- [ ] Desde SQL Editor: `SELECT * FROM smoke_test_schema()` → 8/8 OK
- [ ] Ejecutar: `SELECT * FROM validate_audit_chain(50)` → todos TRUE
- [ ] Verificar en `audit_accesos` que hay eventos de login de todos los usuarios
- [ ] Marcar onboarding completado:
  ```sql
  UPDATE municipalidades SET onboarding_done = TRUE WHERE ubigeo = '{{UBIGEO}}';
  ```
- [ ] Tomar screenshot de `index.html` con branding correcto → archivar como evidencia

---

## POST-ACTIVACIÓN (primera semana)

- [ ] Configurar credenciales SIAF en `integraciones_sync_status` (con soporte MEF)
- [ ] Programar cron de `incrementar_dias_sin_avance()` (Supabase > Edge Functions)
- [ ] Capacitar al alcalde en emitir instrucciones y revisar alertas
- [ ] Capacitar a secretaria en registrar compromisos y subir documentos
- [ ] Capacitar a gerentes en confirmar instrucciones y actualizar avances
- [ ] Primera reunión de revisión semanal del sistema (viernes)

---

## SOPORTE DE EMERGENCIA

- Contraseña olvidada: Supabase Auth > Users > Reset password
- MFA perdido (alcalde): Supabase Auth > Users > Remove MFA factors + ejecutar `UPDATE usuarios SET mfa_habilitado=FALSE WHERE id='...'`
- Usuario bloqueado: `UPDATE usuarios SET activo=TRUE, claims_version=0 WHERE email='...'`
- Borrar tenant completo (rollback): `DELETE FROM municipalidades WHERE ubigeo='{{UBIGEO}}'` (cascada borra todo)

---

*Kausay Municipal · Onboarding v1.0 · Uso interno del equipo técnico*
