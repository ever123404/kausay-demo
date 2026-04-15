# Kausay Municipal — Demo ejecutiva y propuesta de piloto
## Preparación comercial profesional para cierre de piloto institucional

---

## 1. GUION DE DEMO EJECUTIVA (5-7 minutos)

### Instrucciones de presentación
Mostrar en laptop o tablet. Si es presencial, proyectar con pantalla visible para el alcalde.
Voz serena, pausas deliberadas. No apresurarse. Cada sección tiene su momento.
Si hay internet, usar USE_SUPABASE=true con datos del municipio real precargados.

---

### APERTURA — 30 segundos

**[Pantalla: index.html con el escudo del municipio y semáforo real]**

> "Esto es lo que el municipio ve ahora mismo. No lo que vimos ayer. No lo que alguien nos dijo esta mañana. El estado real del municipio a esta hora."

> "Hay [X] alertas críticas, [Y] compromisos vencidos y [Z] obras que necesitan atención. El alcalde merece saberlo antes de entrar a cualquier reunión."

*Pausa de 3 segundos. Dejar que lean los números.*

---

### DOLOR ACTUAL — 45 segundos

**[Sin pantalla — mirar a los ojos]**

> "¿Qué pasa hoy cuando el alcalde necesita saber cómo va una obra? Llama al gerente. El gerente llama a su equipo. Respuesta en horas, si llegan."

> "¿Qué pasa cuando hay una sesión de concejo en 2 horas y un regidor pregunta por el presupuesto de Infraestructura? El asesor busca el archivo. El asistente reenvía el Excel de la semana pasada. El alcalde improvisa."

> "¿Qué pasa cuando el alcalde firma un documento y 6 meses después nadie recuerda quién pidió qué? Nadie. El sistema no lo registra."

> "Kausay resuelve exactamente eso. En tiempo real, con nombre y hora, desde el celular."

---

### CENTRO DE MANDO — 60 segundos

**[Pantalla: alcalde.html — vista de decisiones del día]**

> "Esta es la sala de mando del alcalde. No un reporte semanal. No un Excel compartido. El estado del municipio actualizado."

> "Aquí ve sus decisiones del día: [señalar la más crítica, ej: obra paralizada o plazo MEF próximo]. Esto no lo tuvo que pedir nadie. El sistema lo detectó."

> "Estas son sus instrucciones en curso. [Emitir una instrucción en vivo: escribir algo breve al GM, tono urgente]. Enviada. El GM la recibe ahora."

*Esperar 5 segundos sin hablar.*

> "Ya llegó."

**[Abrir segunda pestaña: gm.html — mostrar la instrucción recién llegada]**

> "Esto es lo que sucede cuando el Estado opera con la misma velocidad que una empresa privada."

---

### PANEL DEL ASESOR — 60 segundos

**[Pantalla: asesor.html — radar del día]**

> "Este es el dashboard del asesor. Y aquí está la diferencia real."

> "El alcalde actúa. El asesor anticipa."

> "[Señalar una obra paralizada en el radar] Esta obra lleva 26 días sin avance. Si el alcalde va a una reunión pública esta tarde y alguien pregunta, ¿tiene respuesta? Con Kausay, el asesor ya lo sabe desde las 8 de la mañana."

**[Click en Briefing ejecutivo]**

> "Esta tarjeta resume en 30 segundos qué pasó, por qué importa y qué debería decidir el alcalde. No requiere preparación de una hora. Está calculado automáticamente."

---

### REALTIME — 20 segundos

**[Dos pantallas o dos tabs: alcalde.html y gm.html]**

> "Cuando el GM confirma la instrucción, [click confirmar] el alcalde lo ve de inmediato. Sin llamada. Sin WhatsApp. Sin 'ya le mandé un correo'."

> "Todo queda registrado, con nombre y hora. Si mañana alguien pregunta quién dio esa instrucción, está aquí."

---

### CARGA REAL DE DATOS — 30 segundos

**[Pantalla: import.html — mostrar un CSV de presupuesto precargado]**

> "¿Cómo entran los datos reales? Así. Un archivo CSV exportado directamente del SIAF. Lo arrastra aquí, ve la vista previa, confirma. En dos minutos, el semáforo de gerencias refleja el presupuesto real de este año."

> "No necesita un técnico. No necesita una integración costosa. El operador del municipio lo hace solo."

---

### PDF INSTITUCIONAL — 20 segundos

**[Click en "Reporte ejecutivo" desde alcalde.html]**

> "Y esto. Antes de cualquier reunión de concejo, el alcalde puede tener este reporte en su teléfono o impreso. Con el escudo del municipio, la fecha, y los datos reales de hoy."

> "No lo preparó nadie. Lo generó el sistema en 4 segundos."

---

### CIERRE — 30 segundos

**[Pantalla: index.html con semáforo municipal]**

> "Lo que acaban de ver no es un prototipo. Está funcionando. Tiene autenticación real, datos reales, y un registro auditable de cada acción."

> "La pregunta no es si el municipio necesita esto. La pregunta es cuándo quieren empezar."

> "Tenemos un piloto de 30 días. En ese tiempo, el alcalde, el asesor y el gerente municipal trabajan con Kausay sobre los datos reales de [nombre del municipio]. Sin costo de implementación inicial. Sin promesas de integración que no podemos cumplir. Solo el sistema funcionando."

> "¿Cuándo podemos agendar la activación?"

---

## 2. NARRATIVA PARA EL ASESOR

### Contexto del asesor
El asesor opera en la brecha entre lo que pasa y lo que el alcalde sabe. Hoy esa brecha se llena con WhatsApp, llamadas, intuición política y reuniones informales. Kausay convierte esa brecha en un sistema.

### Opening específico para el asesor

> "Tu trabajo es que el alcalde nunca llegue sorprendido a una reunión. Pero hoy para saberlo que necesitas saber, tienes que llamar a cuatro personas, revisar tres grupos de WhatsApp y construirte mentalmente un panorama que nadie te preparó."

> "Kausay es el sistema que te da ese panorama preparado a las 8 de la mañana, todos los días, sin pedírselo a nadie."

### Puntos clave para demostrar al asesor

**Anticipación de crisis:**
> "[Mostrar radar de riesgos] ¿Ves esta obra? 26 días sin avance, presupuesto de S/480,000. Si el contratista no se presenta esta semana, hay riesgo de cobertura mediática y pregunta en concejo. El asesor lo sabe hoy, no cuando ya pasó."

**Agenda estratégica:**
> "[Mostrar asesor.html vista agenda] Sesión de concejo a las 3pm. Kausay te dice que ese tipo de reunión tiene riesgo alto — los regidores pueden preguntar sobre obras, presupuesto o compromisos vencidos. ¿Está el briefing listo? [Mostrar briefing pendiente]. No. Tienes tiempo de prepararlo antes."

**Radar reputacional:**
> "Hay 5 compromisos de campo vencidos con alta prioridad. Si alguno de esos actores llama a prensa antes de que el municipio responda, el alcalde está expuesto. El asesor que tiene Kausay lo detecta antes."

**Escalar al alcalde:**
> "[Demostrar el flujo de escalamiento] El asesor escribe el tema, elige la urgencia, confirma con su contraseña. El alcalde lo recibe como instrucción de alerta en su dashboard. Trazable, auditable, con nombre y hora."

**Export PDF inmediato:**
> "Reunión de emergencia en 20 minutos. [Click en Briefing PDF] En 4 segundos tienes un PDF con agenda, riesgos, compromisos sensibles y temas escalados. Lo imprimes o lo mandas por WhatsApp. Sin preparar nada."

---

## 3. NARRATIVA PARA EL ALCALDE

### Contexto del alcalde
El alcalde gestiona por presión, visibilidad y memoria. Lo que no está en el radar no existe. Lo que existe sin nombre y hora no es exigible. Kausay convierte la gestión informal en gobierno documentado.

### Opening específico para el alcalde

> "Señor alcalde, cada decisión que usted toma hoy tiene consecuencia en seis meses. Pero hoy, ¿qué queda registrado de lo que usted instruyó esta mañana? ¿Quién lo recibió? ¿Cuándo lo confirmó? ¿Qué pasó después?"

> "Kausay hace que cada instrucción, cada compromiso y cada alerta quede con su nombre, la hora exacta y el resultado. No para la Contraloría. Para usted."

### Puntos clave para demostrar al alcalde

**Control de gestión sin intermediarios:**
> "[Mostrar alcalde.html instrucciones] Esta instrucción salió a las 9:15. Fue confirmada por el GM a las 9:32. Ya está en el sistema. Si en 15 días no hay resultado, usted lo ve aquí. Sin llamar a nadie."

**Obras críticas:**
> "[Mostrar obra paralizada] Esta obra lleva 26 días sin avance. S/480,000 del presupuesto municipal detenidos. Usted lo sabe ahora, no cuando ya es un problema en el concejo. Puede exigir explicación ahora."

**Compromisos:**
> "[Mostrar compromisos vencidos] Estos dos compromisos con comunidades están vencidos. Si alguien lo interpela en una audiencia, usted sabe exactamente cuál es el estado y quién es el responsable."

**Semáforo de gerencias:**
> "[Mostrar gm.html semáforo] Infraestructura: 71%. Social: 78%. Planeamiento: 39%. El problema está aquí. Sin reunión. Sin reporte. Visible en 3 segundos."

**Protección funcional:**
> "Todo lo que usted hace en el sistema queda registrado en una auditoría inmutable. Si en el futuro alguien cuestiona una decisión, está documentada con nombre, hora y contexto. Eso también lo protege a usted."

**Rapidez:**
> "¿Cuánto tarda hoy en saber cómo va el presupuesto de Infraestructura? [Pausa] ¿Y ahora? [Click] 3 segundos."

---

## 4. OBJECIONES ESPERADAS Y RESPUESTAS

### "¿Cómo se conecta con los sistemas que ya tenemos?"

> "Kausay no reemplaza el SIAF ni el Invierte.pe. Los complementa. Los datos de presupuesto y obras se cargan directamente desde los CSV que ya exportan esos sistemas — los mismos archivos que hoy abren en Excel. La diferencia es que en Kausay esos datos se convierten en semáforos, alertas y decisiones visibles para el alcalde, no solo para el área de planificación."

> "Cuando llegue la integración directa con el MEF, la conexión ya estará lista. Por ahora, el proceso de carga tarda 5 minutos y lo hace el operador del municipio sin asistencia técnica."

### "Ya queda poco tiempo de gestión. ¿Para qué implementar ahora?"

> "Exactamente por eso. El último año de gestión es el más exigente: cierre de obras, rendición de cuentas, compromisos que vencen, presión de la Contraloría. Kausay no es una inversión para la próxima gestión — es una herramienta para cerrar esta gestión con orden y evidencia."

> "Y al terminar el mandato, el sistema queda activo. El nuevo alcalde hereda la historia completa del municipio documentada: instrucciones, compromisos, obras, auditoría. Eso tiene un valor enorme para la transición."

### "¿Qué pasa si tengo varios asesores?"

> "Cada asesor tiene su propia cuenta. Sus acciones quedan registradas por separado. El alcalde ve quién escaló qué. No hay confusión entre asesores, no hay instrucciones sin nombre. Si dos asesores trabajan al mismo tiempo, el sistema los soporta sin mezclar sesiones."

### "¿Cuánto cuesta? ¿Qué implica implementar?"

> "El piloto de 30 días tiene un costo definido por un único concepto: configuración e instalación profesional. No hay costo de licencias durante el piloto. No hay costo de hardware. El sistema corre en la nube."

> "La implementación técnica toma un día. El equipo de Kausay se encarga de la configuración, el branding con el escudo del municipio y la capacitación de los usuarios clave. El alcalde entra el segundo día con el sistema funcionando."

### "¿Es seguro? ¿Quién ve los datos del municipio?"

> "Los datos del municipio están en una base de datos privada, aislada de cualquier otro municipio. Nadie de Kausay puede ver los datos operativos — solo el equipo técnico ante un incidente documentado. El acceso del alcalde requiere su contraseña personal y un código de su teléfono. Si alguien conoce su DNI o correo, no puede entrar sin ese código."

> "Todos los accesos quedan registrados con nombre, hora y dispositivo. Si alguien intenta acceder con las credenciales del alcalde desde otro dispositivo, el sistema lo detecta."

### "¿Y si dependemos de internet y se cae?"

> "El sistema funciona sin conexión. Los dashboards muestran los últimos datos cargados, y cualquier acción que el alcalde tome se guarda localmente y se sincroniza automáticamente cuando regresa la conexión. El sistema muestra claramente cuándo los datos son de una carga sin conexión."

> "Para el contexto de piloto municipal peruano, la continuidad offline está diseñada específicamente."

### "¿Quién da el soporte?"

> "Hay un responsable técnico de Kausay asignado al piloto con contacto directo. Los 3 procedimientos de emergencia más comunes — contraseña olvidada, MFA perdido, usuario bloqueado — tienen un procedimiento documentado que el operador del municipio puede ejecutar solo."

> "Para el piloto de 30 días, el soporte es incluido sin costo adicional."

### "¿Qué pasa si cambia el alcalde?"

> "El sistema es de la institución, no de la persona. Cuando cambia la gestión, el sistema ya tiene configurado el organigrama, el historial de obras, los compromisos y la auditoría completa. El nuevo alcalde hereda contexto, no caos."

> "Las cuentas se actualizan en un día: se desactivan las del alcalde saliente, se crean las del alcalde entrante. El nuevo alcalde entra con la historia del municipio documentada desde el primer día."

---

## 5. PROPUESTA DE PILOTO

### Denominación
**Kausay Municipal — Piloto institucional 30 días**
Activación controlada para [Nombre del municipio] · Gestión [año]

### Duración
30 días naturales desde la fecha de activación técnica.
Revisión a los 15 días. Decisión de continuación al día 30.

### Usuarios incluidos en el piloto
| Rol | Usuarios | Acceso |
|---|---|---|
| Alcalde | 1 | Dashboard ejecutivo + MFA obligatorio |
| Asesor del despacho | 1-2 | Radar estratégico + escalamiento |
| Secretaria | 1 | Workflow de despacho |
| Gerente Municipal | 1 | Coordinación + semáforo de gerencias |
| Gerentes sectoriales | Hasta 4 | Panel sectorial de su área |
| Soporte técnico | 1 (Kausay) | Acceso de configuración |

**Total: hasta 10 usuarios en el piloto.**

### Módulos incluidos
- ✅ Centro de mando ejecutivo (`alcalde.html`)
- ✅ Radar estratégico del asesor (`asesor.html`)
- ✅ Dashboard del Gerente Municipal (`gm.html`)
- ✅ Panel de despacho (`secretaria.html`)
- ✅ Paneles sectoriales de gerencias (`gerente.html`)
- ✅ Portada institucional (`index.html`)
- ✅ Configuración institucional (`config.html`)
- ✅ Importador de datos CSV (`import.html`)
- ✅ Exportación y reporte ejecutivo PDF
- ✅ Sistema de instrucciones con realtime
- ✅ Registro de compromisos y seguimiento
- ✅ Seguimiento de obras
- ✅ Auditoría completa de accesos y acciones

### Lo que incluye el servicio de activación
- Configuración de la instancia con el branding del municipio (escudo, color, nombre)
- Carga inicial de datos desde CSV exportados de SIAF e Invierte.pe
- Creación y configuración de todos los usuarios con sus roles
- Configuración de MFA para el alcalde y el GM
- Capacitación presencial o virtual (2 sesiones de 1 hora cada una):
  - Sesión 1: Alcalde y asesor
  - Sesión 2: GM, secretaria y gerentes
- Soporte técnico directo durante los 30 días
- Documento de resultado al finalizar el piloto

### Lo que requiere del municipio
- Correos institucionales de los usuarios clave
- Nombre oficial completo, tipo de municipalidad y ubigeo
- Escudo municipal en PNG con fondo transparente
- Color institucional primario (o pantone para convertir)
- Disponibilidad del alcalde para 1 sesión de capacitación de 30 minutos
- Un responsable técnico del municipio (puede ser el asistente de sistemas)

---

## 6. CRITERIOS DE ÉXITO EN 30 DÍAS

### Indicadores de adopción (medir al día 30)
| Indicador | Meta para piloto exitoso |
|---|---|
| Días activos del alcalde en el sistema | ≥ 15 de 30 |
| Instrucciones emitidas a través del sistema | ≥ 10 |
| Instrucciones confirmadas por receptores | ≥ 80% de las emitidas |
| Compromisos registrados en el sistema | ≥ 5 nuevos |
| Exportaciones PDF generadas | ≥ 3 (uno por semana) |
| Reportes ejecutivos generados | ≥ 2 (antes de reuniones importantes) |
| Refreshes del CSV de presupuesto | ≥ 1 (al menos una actualización mensual) |

### Indicadores de valor percibido (encuesta al día 30)
| Pregunta | Respuesta esperada para GO |
|---|---|
| "¿Redujo el tiempo para saber el estado de una obra?" | Sí, percepción positiva |
| "¿El alcalde llega mejor preparado a sus reuniones?" | Sí, al menos en 50% de los casos |
| "¿El asesor usa el briefing del sistema antes de reuniones?" | Sí, con frecuencia |
| "¿El sistema registra correctamente las instrucciones del alcalde?" | Sí, funciona bien |
| "¿Continuarían usando el sistema después del piloto?" | Sí definitivamente o Probablemente sí |

### Indicadores de valor técnico (medibles en el sistema)
- Audit log con ≥ 50 eventos registrados → adopción real, no solo login
- Al menos 1 ciclo completo: instrucción emitida → confirmada → seguida
- Al menos 1 alerta crítica detectada y resuelta dentro del sistema
- Al menos 1 obra con avance actualizado via sistema
- Reporte ejecutivo generado antes de una sesión de concejo real

---

## 7. CIERRE COMERCIAL

### Para el ASESOR — conversación de cierre

> **Si el asesor dice "me parece interesante, hay que ver con el alcalde":**

> "Perfecto. Lo que te propongo es esto: déjame mostrarte el sistema con los datos reales del municipio antes de presentarlo al alcalde. En 30 minutos, tú decides qué mostrarle y cómo. Si el alcalde lo ve por primera vez sin contexto, la pregunta técnica va a dominar la conversación. Si lo ves tú primero, la presentación es sobre el valor, no sobre cómo funciona."

> **Si el asesor dice "¿cuándo podemos empezar?":**

> "Esta semana. Lo que necesito de ti es: los correos de los usuarios que quieres incluir, y el escudo del municipio en digital. Con eso, en 48 horas el sistema está configurado con el nombre y el logo del municipio. El alcalde entra el próximo lunes con el sistema listo."

---

### Para el ALCALDE — conversación de cierre

> **Si el alcalde dice "voy a consultarlo con el GM":**

> "Señor alcalde, el GM ya debería estar en la primera sesión de capacitación — no en la decisión de si implementar. Esta es una herramienta de su despacho. Empieza por usted y el asesor. El GM se incorpora en la segunda semana. ¿Cuál es su agenda la próxima semana para la activación?"

> **Si el alcalde dice "¿cuánto cuesta?":**

> "El piloto de 30 días tiene un costo fijo de activación: [número]. Sin sorpresas. Si al final del piloto decide no continuar, el municipio se queda con el registro completo de lo que ocurrió durante esos 30 días — instrucciones, compromisos, auditoría. Eso tiene valor independientemente de lo que decida."

> **Frase de cierre definitiva para el alcalde:**

> "Señor alcalde, usted tiene [X meses] de gestión por delante. La diferencia entre cerrar esa gestión con control o sin él no va a decidirse en los últimos 30 días. Se decide ahora. ¿Empezamos el piloto esta semana?"

---

### Para el GERENTE MUNICIPAL — conversación de cierre

> **Si el GM dice "ya tenemos nuestros sistemas de seguimiento":**

> "Lo que tienen hoy funciona para el área de planificación. Kausay no compite con eso — lo hace visible para el alcalde. El GM sabe cómo va el presupuesto. El problema es que el alcalde lo sabe con una semana de retraso, cuando alguien le prepara el reporte. Kausay elimina ese retraso."

> **Frase de cierre para el GM:**

> "Le propongo esto: en el piloto, usted define qué datos entran al sistema y cómo. Empezamos con lo que ya funciona y lo hacemos visible para el despacho. Usted queda como el articulador entre la operación y la dirección. Eso le da visibilidad política directa al más alto nivel."

---

### SIGUIENTE PASO CONCRETO después de la demo

Independientemente de la respuesta en sala, el cierre debe terminar con una de estas tres acciones concretas antes de salir de la reunión:

**Opción A — Cierre en la reunión:**
> "Bien. Necesito tres cosas para arrancar: su correo institucional, el correo del asesor, y el escudo del municipio en digital. ¿Me los pueden enviar hoy?"

**Opción B — Siguiente reunión agendada:**
> "Entiendo que necesitan consultarlo internamente. ¿Podemos agendar 20 minutos para la próxima semana, en cuanto tengan la respuesta? Con el alcalde o sin él, para resolver las dudas que surjan."

**Opción C — Demo ampliada:**
> "Si quieren que el GM o la secretaria también lo vean antes de decidir, puedo organizar una demo de 30 minutos con el equipo completo esta misma semana. ¿Cuándo tienen disponibilidad?"

**Lo que no debe pasar al salir:** que no haya una próxima acción concreta, con fecha y nombre de responsable.

---

*Kausay Municipal · Material de demo y cierre comercial · Uso interno del equipo comercial*
*Versión para piloto 2024-2025 · No distribuir sin adaptación a cada municipio*
