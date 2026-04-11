-- ============================================================
-- KAUSAY MUNICIPAL — Setup completo de Supabase
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ============================================================

-- 1. TABLA MUNICIPALIDADES (tenant raíz)
create table if not exists municipalidades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text check (tipo in ('distrital','provincial','metropolitana')),
  ubigeo text unique,
  plan_saas text default 'basico' check (plan_saas in ('basico','provincial','premium')),
  activo boolean default true,
  fecha_vencimiento date,
  created_at timestamptz default now()
);

-- 2. TABLA GERENCIAS
create table if not exists gerencias (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  nombre text not null,
  codigo text,
  responsable_id uuid,  -- FK a usuarios, se agrega después
  created_at timestamptz default now()
);

-- 3. TABLA USUARIOS (extiende auth.users)
create table if not exists usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  gerencia_id uuid references gerencias(id),
  nombre text not null,
  email text not null,
  rol text not null check (rol in ('alcalde','secretaria','gerente_municipal','gerente_sectorial')),
  activo boolean default true,
  avatar_iniciales text,
  created_at timestamptz default now()
);

-- FK responsable en gerencias ahora que existe usuarios
alter table gerencias add constraint fk_responsable
  foreign key (responsable_id) references usuarios(id);

-- 4. INSTRUCCIONES (con acuse de recibo)
create table if not exists instrucciones (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  emisor_id uuid references usuarios(id),
  receptor_id uuid references usuarios(id),
  tipo text check (tipo in ('instruccion','consulta','alerta','informe','difusion','coordinacion','chat')),
  contenido text not null,
  leida_en timestamptz,
  confirmada boolean default false,
  compromiso_id uuid,  -- FK opcional a compromisos
  created_at timestamptz default now()
);

-- 5. MENSAJES (chat interno)
create table if not exists mensajes (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  remitente_id uuid references usuarios(id),
  contenido text not null,
  canal text default 'general' check (canal in ('general','directo')),
  leido boolean default false,
  created_at timestamptz default now()
);

-- 6. COMPROMISOS
create table if not exists compromisos (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  responsable_id uuid references usuarios(id),
  descripcion text not null,
  origen text check (origen in ('campo','reunion','concejo','instruccion','otro')),
  origen_referencia text,
  fecha_limite date,
  estado text default 'pendiente' check (estado in ('pendiente','en_proceso','cumplido','vencido')),
  prioridad text default 'media' check (prioridad in ('alta','media','baja')),
  registrado_por uuid references usuarios(id),
  created_at timestamptz default now()
);

-- FK instruccion a compromiso
alter table instrucciones add constraint fk_compromiso
  foreign key (compromiso_id) references compromisos(id);

-- 7. AGENDA
create table if not exists agenda_items (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  creado_por uuid references usuarios(id),
  titulo text not null,
  tipo text check (tipo in ('interna','campo','audiencia','concejo','admin','otra')),
  inicio timestamptz not null,
  fin timestamptz,
  lugar text,
  contexto text,
  briefing_generado boolean default false,
  briefing_contenido text,
  created_at timestamptz default now()
);

-- 8. DOCUMENTOS PARA FIRMA
create table if not exists documentos_firma (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  enviado_por uuid references usuarios(id),
  titulo text not null,
  tipo text check (tipo in ('resolucion','contrato','convenio','oficio','otro')),
  urgencia text default 'normal' check (urgencia in ('urgente','normal')),
  nota text,
  archivo_url text,
  estado text default 'pendiente' check (estado in ('pendiente','aprobado','devuelto')),
  firmado_en timestamptz,
  created_at timestamptz default now()
);

-- 9. OBRAS
create table if not exists obras (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  gerencia_id uuid references gerencias(id),
  nombre text not null,
  estado text default 'proyecto' check (estado in ('proyecto','licitacion','ejecucion','paralizada','entregada')),
  porcentaje_avance integer default 0 check (porcentaje_avance between 0 and 100),
  presupuesto_total decimal(14,2),
  presupuesto_ejecutado decimal(14,2) default 0,
  fecha_inicio date,
  fecha_fin_programada date,
  fecha_fin_real date,
  fuente_financiamiento text,
  cod_invierte text,
  riesgo_ia text check (riesgo_ia in ('bajo','medio','alto','critico')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 10. AVANCES DE OBRA
create table if not exists avances_obra (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid references obras(id) on delete cascade,
  registrado_por uuid references usuarios(id),
  porcentaje integer check (porcentaje between 0 and 100),
  descripcion text,
  evidencia_url text,
  created_at timestamptz default now()
);

-- 11. PRESUPUESTO
create table if not exists presupuesto (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  gerencia_id uuid references gerencias(id),
  anio integer not null,
  fuente text,
  asignado decimal(14,2) default 0,
  comprometido decimal(14,2) default 0,
  devengado decimal(14,2) default 0,
  ejecutado decimal(14,2) default 0,
  updated_at timestamptz default now()
);

-- 12. PLAZOS NORMATIVOS
create table if not exists plazos_normativos (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  responsable_id uuid references usuarios(id),
  sistema text not null,
  descripcion text not null,
  fecha_vencimiento date not null,
  dias_alerta integer default 15,
  estado text default 'pendiente' check (estado in ('pendiente','en_proceso','cumplido','vencido')),
  alertado boolean default false,
  created_at timestamptz default now()
);

-- 13. ALERTAS
create table if not exists alertas (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  tipo text not null,
  nivel text check (nivel in ('critica','alerta','info')),
  mensaje text not null,
  entidad_tipo text,
  entidad_id uuid,
  leida boolean default false,
  created_at timestamptz default now()
);

-- 14. REPORTES IA
create table if not exists reportes_ia (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  generado_para uuid references usuarios(id),
  tipo text check (tipo in ('diario','semanal','mensual','pre_reunion','pre_concejo')),
  periodo text,
  contenido jsonb,
  generado_en timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — aislamiento multi-tenant
-- ============================================================

alter table municipalidades      enable row level security;
alter table gerencias            enable row level security;
alter table usuarios             enable row level security;
alter table instrucciones        enable row level security;
alter table mensajes             enable row level security;
alter table compromisos          enable row level security;
alter table agenda_items         enable row level security;
alter table documentos_firma     enable row level security;
alter table obras                enable row level security;
alter table avances_obra         enable row level security;
alter table presupuesto          enable row level security;
alter table plazos_normativos    enable row level security;
alter table alertas              enable row level security;
alter table reportes_ia          enable row level security;

-- Función helper: obtener municipalidad_id del usuario autenticado
create or replace function get_municipalidad_id()
returns uuid language sql security definer stable as $$
  select municipalidad_id from usuarios where id = auth.uid()
$$;

-- Función helper: obtener rol del usuario autenticado
create or replace function get_user_rol()
returns text language sql security definer stable as $$
  select rol from usuarios where id = auth.uid()
$$;

-- Políticas RLS — mismo patrón para todas las tablas
create policy "usuarios ven solo su municipalidad" on usuarios
  for all using (municipalidad_id = get_municipalidad_id());

create policy "gerencias de la misma municipalidad" on gerencias
  for all using (municipalidad_id = get_municipalidad_id());

create policy "instrucciones de la municipalidad" on instrucciones
  for all using (municipalidad_id = get_municipalidad_id());

create policy "mensajes de la municipalidad" on mensajes
  for all using (municipalidad_id = get_municipalidad_id());

create policy "compromisos de la municipalidad" on compromisos
  for all using (municipalidad_id = get_municipalidad_id());

create policy "agenda de la municipalidad" on agenda_items
  for all using (municipalidad_id = get_municipalidad_id());

create policy "docs firma de la municipalidad" on documentos_firma
  for all using (municipalidad_id = get_municipalidad_id());

create policy "obras de la municipalidad" on obras
  for all using (municipalidad_id = get_municipalidad_id());

create policy "avances de obras de la municipalidad" on avances_obra
  for all using (
    obra_id in (select id from obras where municipalidad_id = get_municipalidad_id())
  );

create policy "presupuesto de la municipalidad" on presupuesto
  for all using (municipalidad_id = get_municipalidad_id());

create policy "plazos de la municipalidad" on plazos_normativos
  for all using (municipalidad_id = get_municipalidad_id());

create policy "alertas de la municipalidad" on alertas
  for all using (municipalidad_id = get_municipalidad_id());

create policy "reportes de la municipalidad" on reportes_ia
  for all using (municipalidad_id = get_municipalidad_id());

-- Política especial: gerentes sectoriales solo ven sus obras
create policy "gs solo ve obras de su gerencia" on obras
  for all using (
    municipalidad_id = get_municipalidad_id()
    and (
      get_user_rol() in ('alcalde','secretaria','gerente_municipal')
      or gerencia_id in (
        select gerencia_id from usuarios where id = auth.uid()
      )
    )
  );

-- ============================================================
-- REALTIME — habilitar para las tablas en vivo
-- ============================================================
alter publication supabase_realtime add table obras;
alter publication supabase_realtime add table avances_obra;
alter publication supabase_realtime add table instrucciones;
alter publication supabase_realtime add table mensajes;
alter publication supabase_realtime add table alertas;
alter publication supabase_realtime add table compromisos;
alter publication supabase_realtime add table documentos_firma;

-- ============================================================
-- DATOS DE PRUEBA — Municipalidad de Cajamarca
-- ============================================================

-- 1. Insertar municipalidad
insert into municipalidades (id, nombre, tipo, ubigeo, plan_saas)
values ('11111111-1111-1111-1111-111111111111', 'Municipalidad Provincial de Cajamarca', 'provincial', '060101', 'provincial')
on conflict do nothing;

-- 2. Insertar gerencias
insert into gerencias (id, municipalidad_id, nombre, codigo) values
  ('aaaaaaaa-0001-0001-0001-000000000001', '11111111-1111-1111-1111-111111111111', 'Infraestructura y Obras', 'INFRA'),
  ('aaaaaaaa-0001-0001-0001-000000000002', '11111111-1111-1111-1111-111111111111', 'Desarrollo Social', 'SOCIAL'),
  ('aaaaaaaa-0001-0001-0001-000000000003', '11111111-1111-1111-1111-111111111111', 'Rentas y Tributación', 'RENTAS'),
  ('aaaaaaaa-0001-0001-0001-000000000004', '11111111-1111-1111-1111-111111111111', 'Servicios Municipales', 'SERVICIOS'),
  ('aaaaaaaa-0001-0001-0001-000000000005', '11111111-1111-1111-1111-111111111111', 'Secretaría General', 'SECRETARIA'),
  ('aaaaaaaa-0001-0001-0001-000000000006', '11111111-1111-1111-1111-111111111111', 'Planeamiento y Presupuesto', 'PLANIF')
on conflict do nothing;

-- NOTA: Los usuarios se crean primero en Supabase Auth (Dashboard > Authentication > Users)
-- luego se insertan aquí con el UUID que Supabase asigna.
-- 
-- Emails de prueba sugeridos:
--   alcalde@municipalidadcajamarca.gob.pe     → rol: alcalde
--   secretaria@municipalidadcajamarca.gob.pe  → rol: secretaria
--   gm@municipalidadcajamarca.gob.pe          → rol: gerente_municipal
--   infraestructura@municipalidadcajamarca.gob.pe → rol: gerente_sectorial
--
-- Después de crear los usuarios en Auth, ejecutar:
-- insert into usuarios (id, municipalidad_id, nombre, email, rol, avatar_iniciales)
-- values ('<UUID-DE-SUPABASE-AUTH>', '11111111-...', 'Roberto Sánchez Q.', '...', 'alcalde', 'RS');

-- 3. Obras de prueba
insert into obras (municipalidad_id, gerencia_id, nombre, estado, porcentaje_avance, presupuesto_total, fecha_fin_programada) values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000001','Pavimentación Jr. Lima cuadra 8-12','paralizada',34,480000,'2024-12-15'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000001','Construcción mercado La Colmena','ejecucion',68,1200000,'2025-02-28'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000001','Red agua potable sector norte','ejecucion',51,680000,'2025-03-31'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000004','Mejoramiento parque principal','ejecucion',82,95000,'2024-12-08')
on conflict do nothing;

-- 4. Presupuesto de prueba
insert into presupuesto (municipalidad_id, gerencia_id, anio, asignado, ejecutado) values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000001',2024,4850000,3421000),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000002',2024,1200000,940000),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000003',2024,380000,155000),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000004',2024,920000,512000),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0001-0001-0001-000000000006',2024,185000,72000)
on conflict do nothing;

-- 5. Plazos normativos de prueba
insert into plazos_normativos (municipalidad_id, sistema, descripcion, fecha_vencimiento, dias_alerta) values
  ('11111111-1111-1111-1111-111111111111','MEF/SIAF','Devengado 4to trimestre','2024-12-15',30),
  ('11111111-1111-1111-1111-111111111111','Invierte.pe','Actualizar avance físico 3 proyectos','2024-12-08',15),
  ('11111111-1111-1111-1111-111111111111','Contraloría','Subsanación hallazgos informe 2024','2024-12-20',30),
  ('11111111-1111-1111-1111-111111111111','SEACE','Renovación contratos servicios','2024-12-31',30)
on conflict do nothing;

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================

-- ============================================================
-- ACTUALIZACIÓN v1.1 — Módulo de comunicación dirigida
-- Ejecutar si ya tenías el schema anterior instalado
-- ============================================================

-- Ampliar tipos de instrucción (difusión, coordinación, chat GM)
alter table instrucciones drop constraint if exists instrucciones_tipo_check;
alter table instrucciones add constraint instrucciones_tipo_check
  check (tipo in ('instruccion','consulta','alerta','informe','difusion','coordinacion','chat'));

-- Tabla de coordinaciones multi-área (instrucciones que involucran varias gerencias)
create table if not exists coordinaciones_areas (
  id uuid primary key default gen_random_uuid(),
  instruccion_id uuid references instrucciones(id) on delete cascade,
  gerencia_id    uuid references gerencias(id) on delete cascade,
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  created_at timestamptz default now()
);
alter table coordinaciones_areas enable row level security;
create policy "coordinaciones de la municipalidad" on coordinaciones_areas
  for all using (municipalidad_id = get_municipalidad_id());

-- Tabla de exportaciones registradas (auditoría de quién exportó qué y cuándo)
create table if not exists exportaciones (
  id uuid primary key default gen_random_uuid(),
  municipalidad_id uuid references municipalidades(id) on delete cascade,
  usuario_id       uuid references usuarios(id),
  modulo           text not null,        -- 'agenda','documentos','compromisos','obras','kpis','todo', etc.
  rol              text not null,        -- 'secretaria','gerente_sectorial','gerente_municipal','alcalde'
  gerencia_id      uuid references gerencias(id),
  created_at       timestamptz default now()
);
alter table exportaciones enable row level security;
create policy "exportaciones de la municipalidad" on exportaciones
  for all using (municipalidad_id = get_municipalidad_id());

-- Realtime también para instrucciones nuevas (ya estaba, pero por si acaso)
-- alter publication supabase_realtime add table instrucciones; -- ya incluida en v1.0

-- ============================================================
-- ÍNDICES de rendimiento (recomendados para municipalidades grandes)
-- ============================================================
create index if not exists idx_instrucciones_receptor   on instrucciones(receptor_id, created_at desc);
create index if not exists idx_instrucciones_emisor     on instrucciones(emisor_id, created_at desc);
create index if not exists idx_instrucciones_muni       on instrucciones(municipalidad_id, created_at desc);
create index if not exists idx_compromisos_responsable  on compromisos(responsable_id, estado);
create index if not exists idx_compromisos_muni         on compromisos(municipalidad_id, estado);
create index if not exists idx_obras_gerencia           on obras(gerencia_id, estado);
create index if not exists idx_avances_obra             on avances_obra(obra_id, created_at desc);
create index if not exists idx_plazos_vencimiento       on plazos_normativos(municipalidad_id, fecha_vencimiento);
create index if not exists idx_exportaciones_muni       on exportaciones(municipalidad_id, created_at desc);

-- ============================================================
-- FIN ACTUALIZACIÓN v1.1
-- ============================================================
