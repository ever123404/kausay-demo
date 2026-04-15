# Kausay Municipal — Checklist operativo de integraciones
## Para uso del operador técnico / responsable de datos

---

## CARGA INICIAL (primer uso o nuevo período)

### Presupuesto SIAF
- [ ] Ingresar a SIAF GL → Consultas → Ejecución del Gasto
- [ ] Filtrar por: Unidad Ejecutora = `{{CODIGO_UE}}`, Año = `{{ANIO}}`
- [ ] Exportar en formato CSV o Excel → guardar como `presupuesto_{{ANIO}}_{{MES}}.csv`
- [ ] Verificar que las columnas incluyen: `gerencia`, `asignado`, `ejecutado`
  - Si el SIAF exporta por "Genérica de gasto", mapear manualmente a gerencia en el CSV
- [ ] Abrir `config.html` → Importar datos → Presupuesto SIAF
- [ ] Arrastrar el archivo → verificar vista previa → confirmar importación
- [ ] Verificar en `gm.html` que el semáforo de gerencias refleja los montos nuevos
- [ ] Registrar en el audit: la importación queda en `auditoria_eventos` automáticamente

### Obras Invierte.pe
- [ ] Ir a https://ofi5.mef.gob.pe/invierte/consulta/tipoprioridad
- [ ] Filtrar por: Unidad Ejecutora = `{{CODIGO_UE}}`
- [ ] Exportar a Excel → convertir a CSV → guardar como `obras_{{FECHA}}.csv`
- [ ] Verificar columnas: `nombre`, `codigo_invierte`, `pct_avance`, `monto`, `estado`
- [ ] Importar en `config.html` → Importar datos → Obras Invierte.pe
- [ ] Verificar en `alcalde.html` y `gm.html` que las obras aparecen con avance actualizado
- [ ] Comparar con datos manuales ingresados por gerentes — si hay diferencia, la fuente externa manda

### Compromisos
- [ ] No tiene fuente externa — registro manual obligatorio
- [ ] Usar la plantilla CSV descargada desde el importador
- [ ] Completar: descripción, responsable (código gerencia), fecha límite, origen, prioridad
- [ ] Importar y verificar en `alcalde.html` → Compromisos

---

## REFRESH PERIÓDICO

| Fuente | Frecuencia recomendada | Responsable |
|---|---|---|
| Presupuesto SIAF | Semanal (lunes antes de la reunión de staff) | GM o Planeamiento |
| Obras Invierte.pe | Quincenal o al registrar avance | Infraestructura |
| Compromisos | Al adquirir uno nuevo | Secretaria o asesor |

---

## SI CAE LA INTEGRACIÓN (fuente no disponible)

1. El badge de frescura cambia a ⏱ o 📡 en todos los dashboards
2. Los datos mostrados son de la **última carga exitosa** — no hay datos incorrectos, solo desactualizados
3. Verificar si el portal MEF/Invierte.pe está disponible (mantenimiento nocturno habitual: 02:00-05:00)
4. Si el problema persiste más de 24h: actualizar datos manualmente desde los sistemas fuente
5. Registrar en el log de soporte: fecha, sistema, error observado, acción tomada

---

## RECUPERACIÓN MANUAL (cuando la integración externa no está disponible)

```
Procedimiento de emergencia antes de reunión de alcalde:
1. Llamar directamente al GM o responsable del área para obtener cifras verbales
2. Ingresar manualmente en el dashboard correspondiente:
   - Avance de obra: gerente.html → actualizar avance
   - Presupuesto: usar plantilla CSV y actualizar los montos conocidos
3. El badge de frescura mostrará "Datos manuales" con timestamp
4. Informar al alcalde que los datos son actualizados manualmente
```

---

## VALIDACIÓN RÁPIDA ANTES DE REUNIÓN CON EL ALCALDE

Ejecutar 30 minutos antes de la reunión:
- [ ] Abrir `alcalde.html` — verificar que el semáforo general coincide con lo esperado
- [ ] Revisar el badge de frescura — si muestra más de 24h, actualizar presupuesto
- [ ] Abrir `asesor.html` — verificar sección "Radar de riesgos" — ¿hay sorpresas nuevas?
- [ ] Verificar en `gm.html` las gerencias en rojo — preparar respuesta si el alcalde pregunta
- [ ] Si hay sesión de concejo ese día: verificar todos los compromisos vencidos en `alcalde.html`
- [ ] Confirmar que las obras críticas tienen actualización de avance reciente (últimas 72h)

---

## LO QUE NO DEBE VENDERSE COMO AUTOMATIZACIÓN TOTAL

| ❌ No decir | ✅ Decir en cambio |
|---|---|
| "Sincroniza automáticamente con el MEF" | "Se actualiza con carga manual asistida desde SIAF" |
| "Datos en tiempo real de Invierte.pe" | "Datos actualizados al último CSV importado" |
| "Integración directa con SEACE" | "SEACE no está integrado en la versión de piloto" |
| "El sistema detecta automáticamente obras nuevas" | "Las obras nuevas se ingresan manualmente o via CSV" |
| "Sincronización automática cada hora" | "La frescura de datos depende de la carga manual periódica" |

---

*Kausay Municipal · Integraciones v1.0 · Para el operador técnico del piloto*
