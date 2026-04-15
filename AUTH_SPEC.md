# Kausay Municipal — Auth Specification v1.0
## Formal access matrix, reauth actions, demo vs production

---

## 1. MATRIZ DE ACCESO POR PANTALLA

### Regla general
Toda pantalla protegida llama `KausayAuth.requireAuth(roles)` al inicio del
`window.addEventListener('load')`. Si la verificación falla, redirige a
`login.html` con el parámetro de error correspondiente.

### Tabla de acceso

| Pantalla | Roles permitidos | Condición adicional |
|---|---|---|
| `index.html` | Todos (portada pública) | Muestra accesos disponibles según sesión activa |
| `login.html` | Sin sesión requerida | Si hay sesión válida → redirige por rol |
| `alcalde.html` | `alcalde`, `asesor_despacho` | — |
| `secretaria.html` | `secretaria`, `asesor_despacho` | — |
| `gm.html` | `gerente_municipal`, `alcalde`, `asesor_despacho` | — |
| `gerente.html` | `gerente_sectorial`, `gerente_municipal` | `gerencia_cod` requerido para `gerente_sectorial` |
| `config.html` | `alcalde`, `soporte_kausay` | — |

### Qué pasa en cada caso de error

| Situación | Comportamiento | Destino |
|---|---|---|
| Sin sesión (no logueado) | `requireAuth()` redirige | `login.html` |
| Sesión expirada (TTL 7d) | `requireAuth()` limpia sesión y redirige | `login.html` |
| Rol incorrecto (ej: secretaria en alcalde.html) | `requireAuth()` redirige con error | `login.html?error=no_autorizado` |
| Usuario inactivo (`activo: false`) | `_loadSession()` invalida la sesión | `login.html` |
| MFA no completado (alcalde / GM) | `requireAuth()` detecta `!mfa_verified` | `login.html?mfa=1&redirect=...` |
| `gerente_sectorial` sin `gerencia_cod` | Bloqueo explícito en `gerente.html` | `login.html?error=sin_gerencia` |
| Token de Supabase expirado (Etapa 4) | `SupabaseAuth.refreshSession()` → si falla, limpia | `login.html` |

---

## 2. ACCIONES CRÍTICAS CON REAUTENTICACIÓN

`KausayAuth.reauth(motivo)` abre el overlay de verificación de contraseña.
Si el usuario ya reautenticó hace menos de 15 minutos, no se vuelve a pedir.
Si cancela, la acción no se ejecuta y se muestra toast de advertencia.

### Tabla de acciones y ubicación

| Acción | Dashboard | Función | Motivo visible al usuario |
|---|---|---|---|
| Aprobar documento para firma | `alcalde.html` | `firmarDoc(id, 'aprobado')` | "Aprobar o devolver documento" |
| Devolver documento | `alcalde.html` | `firmarDoc(id, 'devuelto')` | "Aprobar o devolver documento" |
| Aprobar documento (despacho) | `secretaria.html` | `aprobarDoc(id)` | "Aprobar documento para firma del alcalde" |
| Escalar al alcalde | `gm.html` | `escalerAlcalde(tipo, desc)` | "Escalar situación crítica al alcalde" |
| Escalar al GM | `gerente.html` | `enviarEscalamiento()` | "Escalar situación al Gerente Municipal" |
| Actualizar avance de obra | `gerente.html` | `actualizarAvance(obraId)` | "Actualizar avance de obra registrado en Contraloría" |
| Cambiar configuración institucional | `config.html` (Sprint 3) | `guardarConfig()` | "Cambiar configuración institucional" |
| Emitir instrucción urgente | `alcalde.html` (parcial) | `enviarInstruccion()` si prioridad=urgente | "Instrucción urgente — verificación requerida" |
| Revocar sesión de otro usuario | `config.html` (Sprint 3) | `revocarSesion(userId)` | "Revocar acceso de usuario" |

### Flujo técnico de reauth

```
Dashboard llama KausayAuth.reauth('motivo')
  ↓
auth.js emite CustomEvent('kausay:reauth_required', { motivo })
  ↓
login.html (overlay) captura el evento → muestra modal de contraseña
  ↓
Usuario ingresa contraseña → KausayAuth.confirmReauth(pw)
  ↓
MockAuth/SupabaseAuth verifica credenciales
  ↓
Emite CustomEvent('kausay:reauth_done', { success: true/false })
  ↓
Dashboard recibe → ejecuta acción si success === true
  ↓
Audit: registra 'reauth_success' o 'reauth_failed' con motivo, usuario, timestamp
```

### Por qué estas acciones y no otras

Las acciones de reauth fueron seleccionadas por tres criterios:
1. **Impacto legal o presupuestal** — aprobar documentos, actualizar avance de obra
2. **Visibilidad política** — escalar al alcalde, emitir instrucciones urgentes
3. **Irreversibilidad** — cambiar configuración institucional

Las acciones de lectura, filtrado y navegación **no requieren reauth** —
agregan fricción sin beneficio de seguridad.

---

## 3. SEPARACIÓN FORMAL DEMO vs PRODUCCIÓN

### ✅ LO QUE YA FUNCIONA EN DEMO (Etapas 1-3)

| Componente | Estado demo | Comportamiento |
|---|---|---|
| Login con email/contraseña | ✅ Funcional | MockAdapter verifica contra MOCK_USERS hardcodeados |
| Sesión persistente | ✅ Funcional | localStorage con TTL de 7 días |
| Redirección por rol | ✅ Funcional | REDIRECT_MAP completo con todos los roles |
| requireAuth() en dashboards | ✅ Funcional | Bloquea acceso sin sesión o con rol incorrecto |
| reauth() en acciones críticas | ✅ Funcional | Pide contraseña antes de ejecutar la acción |
| Audit log de acceso | ✅ Funcional | Guarda en localStorage (kausay_auth_audit) |
| Device fingerprint | ✅ Funcional | Hash del user-agent, no PII |
| Cerrar sesión | ✅ Funcional | Limpia localStorage + sessionStorage |
| Reset de contraseña (UX) | ✅ Flujo UI | Muestra confirmación pero NO envía email real |
| MFA (UX) | ✅ Flujo UI | 6 dígitos numéricos — cualquier código es válido |

### ⚠️ DEUDA DE SEGURIDAD DEMO — NO CONFUNDIR CON PRODUCCIÓN

| Componente | Estado DEMO | Estado PRODUCCIÓN (Etapa 4) |
|---|---|---|
| **MFA** | ⚠️ MOCK — cualquier código de 6 dígitos válido | Supabase TOTP con QR de configuración |
| **Contraseñas** | ⚠️ Hardcodeadas en auth.js (texto plano) | Bcrypt gestionado por Supabase Auth |
| **Reset de contraseña** | ⚠️ No envía email | Supabase envía email con token de reset |
| **JWT** | ⚠️ Objeto JSON en localStorage (no firmado) | JWT firmado HS256 por Supabase, expira en 1h |
| **Sesión única por alcalde** | ⚠️ No verificada (solo flag) | Supabase revoca tokens anteriores al login |
| **Detección dispositivo nuevo** | ⚠️ Fingerprint generado, no usado para alertar | Comparar fingerprint vs historial + notificar |
| **Audit en base de datos** | ⚠️ Solo localStorage (volátil) | INSERT en auditoria_eventos (inmutable) |
| **HTTPS obligatorio** | ⚠️ No enforced en local/demo | Cloudflare Pages enforza HTTPS |
| **Rate limiting intentos fallidos** | ⚠️ No implementado | Supabase Auth bloquea tras 5 intentos |
| **Biometría / WebAuthn** | ⚠️ No implementado | Etapa 6 — Web Authentication API |
| **Revocación remota** | ⚠️ Solo local | Supabase Admin API invalida todos los tokens |

### 🔴 ADVERTENCIA FORMAL

> **El MFA de demo NO proporciona seguridad real.**
> Cualquier código de 6 dígitos es válido en Etapas 1-3.
> Esto es exclusivamente para demostración del flujo UX.
> **No desplegar en producción con `USE_SUPABASE: false`.**
> La activación de `USE_SUPABASE: true` en `auth.js` reemplaza
> automáticamente MockAuth por SupabaseAuth, que usa TOTP real.

### 🟡 DEUDA PENDIENTE AL ACTIVAR SUPABASE

Al cambiar `USE_SUPABASE: true`, estas tareas quedan pendientes:

1. Ejecutar `supabase-setup.sql` con las tablas de usuarios y RLS
2. Crear usuarios en Supabase Auth (dashboard de Supabase)
3. Configurar el hook `auth.jwt_claims_hook` para inyectar `rol`, `gerencia_id`, `municipalidad_id` en el JWT
4. Habilitar TOTP en Supabase Auth (MFA real)
5. Configurar SMTP para emails de reset de contraseña
6. Verificar que `SupabaseAuth.refreshSession()` renueve el token antes del vencimiento (1h)
7. Implementar detección de dispositivo nuevo con alerta al usuario
8. Configurar revocación automática de sesiones del alcalde al detectar login desde otro IP

---

## 4. USUARIOS DEMO — REFERENCIA COMPLETA

| Email | Contraseña | Rol | Gerencia | MFA requerido |
|---|---|---|---|---|
| `alcalde@cajamarca.gob.pe` | `Cajamarca2024!` | alcalde | — | ✓ Sí |
| `secretaria@cajamarca.gob.pe` | `Despacho2024!` | secretaria | — | No |
| `gm@cajamarca.gob.pe` | `Gerencia2024!` | gerente_municipal | — | ✓ Sí |
| `infra@cajamarca.gob.pe` | `Infra2024!` | gerente_sectorial | INFRA | No |
| `rentas@cajamarca.gob.pe` | `Rentas2024!` | gerente_sectorial | RENTAS | No |
| `servicios@cajamarca.gob.pe` | `Serv2024!` | gerente_sectorial | SERVICIOS | No |
| `social@cajamarca.gob.pe` | `Social2024!` | gerente_sectorial | SOCIAL | No |
| `secretariaG@cajamarca.gob.pe` | `SecG2024!` | gerente_sectorial | SECRETARIA | No |
| `planif@cajamarca.gob.pe` | `Planif2024!` | gerente_sectorial | PLANIF | No |
| `oci@cajamarca.gob.pe` | `Oci2024!` | oci_lectura | — | No |

> **En demo:** el MFA del alcalde y del GM acepta cualquier código de 6 dígitos.
> Usar `123456` para pruebas rápidas.

---

*Kausay Municipal · Auth Specification v1.0 · Uso interno*
