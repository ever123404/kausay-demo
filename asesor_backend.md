# Kausay Municipal — Cambios de backend para asesor_despacho
## Cambios mínimos necesarios

### 1. supabase-setup.sql — rol ya definido ✅
El rol `asesor_despacho` ya está en el CHECK constraint de la tabla `usuarios`:
```sql
rol IN ('alcalde','secretaria','gerente_municipal','gerente_sectorial',
        'asesor_despacho','planeamiento','oci_lectura','soporte_kausay')
```
**No requiere cambio de schema.**

### 2. RLS — acceso de lectura global dentro del tenant
El asesor necesita visibilidad transversal. Los policies existentes ya lo incluyen:

- `instrucciones`: asesor_despacho está en `get_user_rol() IN ('alcalde','gerente_municipal','asesor_despacho',...)`  ✅
- `compromisos`: idem ✅
- `alertas`: idem ✅
- `agenda_items`: idem ✅
- `documentos_firma`: idem ✅
- `obras`: asesor_despacho está en el policy SELECT ✅
- `reportes_ia`: idem ✅

**No requiere cambio de RLS.**

### 3. JWT claims hook — ya incluye asesor_despacho ✅
`kausay_jwt_claims_hook()` inyecta `rol:'asesor_despacho'` cuando el usuario tiene ese rol.
`can_access()` valida tenant. No requiere cambio.

### 4. auth.js — REDIRECT_MAP ya incluye asesor_despacho ✅
```js
asesor_despacho: 'alcalde.html',  // CAMBIAR A 'asesor.html'
```
**Este sí requiere cambio**: actualizar el REDIRECT_MAP en auth.js.

### 5. onboarding.sql — agregar asesor(es) al seed
En el bloque de usuarios, agregar:
```sql
('{{UUID_ASESOR_1}}'::UUID, v_muni_id, '{{EMAIL_ASESOR_1}}', '{{NOMBRE_ASESOR_1}}',
 'asesor_despacho', NULL, NULL, TRUE, FALSE, 0)
```

### 6. AUTH_SPEC.md — actualizar matriz de acceso
| asesor.html | asesor_despacho, alcalde, soporte_kausay | — |
