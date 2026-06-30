-- ============================================================
-- TERMINAL NOVO REMANSO - CONTROLE DE ENTRADAS/SAÍDAS E ESTOQUE
-- Schema Supabase (Postgres + RLS)
-- ============================================================

-- ---------- EXTENSÕES ----------
create extension if not exists "uuid-ossp";

-- ---------- ENUMS ----------
create type user_role as enum ('admin', 'operacao', 'cliente');
create type produto_tipo as enum ('soja', 'milho');
create type navio_status as enum ('previsto', 'atracado', 'carregando', 'concluido');

-- ---------- CONFIGURAÇÕES GERAIS ----------
create table public.configuracoes (
  id int primary key default 1,
  capacidade_total_ton numeric not null default 85000,
  nome_terminal text not null default 'Terminal Novo Remanso',
  constraint singleton check (id = 1)
);
insert into public.configuracoes (id) values (1) on conflict do nothing;

-- ---------- CLIENTES (ADM, COFCO, BUNGE, LDC, ...) ----------
create table public.clientes (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- PERFIS DE USUÁRIO (vinculado ao auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role user_role not null default 'cliente',
  cliente_id uuid references public.clientes(id), -- obrigatório se role = cliente
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- COMBOIOS (NAVEGAÇÃO PVH -> NOVO REMANSO) ----------
create table public.comboios (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  produto produto_tipo not null,
  data_saida_pvh date,
  eta date,            -- previsão de chegada em Novo Remanso
  ets date,            -- previsão de saída/liberação
  observacoes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- DESCARGA DE BARCAÇAS (ENTRADAS) ----------
create table public.descargas_barcacas (
  id uuid primary key default uuid_generate_v4(),
  comboio_id uuid references public.comboios(id) on delete set null,
  cliente_id uuid not null references public.clientes(id),
  data date not null,
  hora int check (hora between 1 and 3), -- turno 1/2/3 conforme planilha
  numero_bg text,            -- identificação da barcaça
  qtd_bg numeric not null check (qtd_bg >= 0),     -- toneladas da barcaça
  qtd_comboio numeric,        -- total do comboio (informativo)
  previsao boolean not null default false, -- true = ainda é previsão, false = realizado
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- NAVIOS (PROGRAMAÇÃO DE EMBARQUE) ----------
create table public.navios (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  cliente_id uuid not null references public.clientes(id), -- proprietário da carga
  produto produto_tipo not null,
  eta_itacoatiara date,
  etb_novo_remanso date,
  estada_dias int,
  volume_previsto numeric not null check (volume_previsto >= 0),
  status navio_status not null default 'previsto',
  observacoes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- SAÍDAS DE NAVIO (CARGA EFETIVAMENTE EMBARCADA) ----------
create table public.saidas_navio (
  id uuid primary key default uuid_generate_v4(),
  navio_id uuid references public.navios(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id),
  data date not null,
  volume numeric not null check (volume >= 0),
  previsao boolean not null default false, -- true = previsão, false = realizado
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- QUEBRA TÉCNICA (AJUSTE POR CLIENTE) ----------
create table public.quebras_tecnicas (
  id uuid primary key default uuid_generate_v4(),
  cliente_id uuid not null references public.clientes(id),
  data date not null,
  percentual numeric not null default 0, -- ex: 0.02 = 2%
  volume_ajuste numeric not null default 0,
  observacoes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- VIEWS DE ESTOQUE / PREVISÃO
-- ============================================================

-- Entradas consolidadas por cliente e data (realizado vs previsão)
create or replace view public.vw_entradas_diarias as
select
  cliente_id,
  data,
  previsao,
  sum(qtd_bg) as total_entrada
from public.descargas_barcacas
group by cliente_id, data, previsao;

-- Saídas consolidadas por cliente e data (realizado vs previsão)
create or replace view public.vw_saidas_diarias as
select
  cliente_id,
  data,
  previsao,
  sum(volume) as total_saida
from public.saidas_navio
group by cliente_id, data, previsao;

-- Quebra técnica acumulada por cliente
create or replace view public.vw_quebra_por_cliente as
select
  cliente_id,
  sum(volume_ajuste) as quebra_total
from public.quebras_tecnicas
group by cliente_id;

-- Estoque ATUAL por cliente (somente realizado, previsao = false)
create or replace view public.vw_estoque_atual_cliente as
select
  c.id as cliente_id,
  c.nome as cliente_nome,
  coalesce(e.total, 0) as total_entradas,
  coalesce(s.total, 0) as total_saidas,
  coalesce(q.quebra_total, 0) as quebra_total,
  coalesce(e.total, 0) - coalesce(s.total, 0) - coalesce(q.quebra_total, 0) as saldo_atual
from public.clientes c
left join (
  select cliente_id, sum(qtd_bg) as total
  from public.descargas_barcacas
  where previsao = false
  group by cliente_id
) e on e.cliente_id = c.id
left join (
  select cliente_id, sum(volume) as total
  from public.saidas_navio
  where previsao = false
  group by cliente_id
) s on s.cliente_id = c.id
left join public.vw_quebra_por_cliente q on q.cliente_id = c.id;

-- Estoque atual TOTAL do terminal (todos os clientes)
create or replace view public.vw_estoque_atual_total as
select
  sum(saldo_atual) as estoque_total,
  (select capacidade_total_ton from public.configuracoes where id = 1) as capacidade_total,
  round(
    100.0 * sum(saldo_atual) / nullif((select capacidade_total_ton from public.configuracoes where id = 1), 0), 2
  ) as percentual_ocupado
from public.vw_estoque_atual_cliente;

-- Linha do tempo de movimentações (realizado + previsão) por cliente e dia,
-- usada para projetar o estoque futuro dia a dia
create or replace view public.vw_movimentos_linha_tempo as
select
  cliente_id,
  data,
  previsao,
  coalesce(entrada, 0) as entrada,
  coalesce(saida, 0) as saida,
  coalesce(entrada, 0) - coalesce(saida, 0) as saldo_dia
from (
  select
    coalesce(en.cliente_id, sa.cliente_id) as cliente_id,
    coalesce(en.data, sa.data) as data,
    coalesce(en.previsao, sa.previsao) as previsao,
    en.total_entrada as entrada,
    sa.total_saida as saida
  from public.vw_entradas_diarias en
  full outer join public.vw_saidas_diarias sa
    on en.cliente_id = sa.cliente_id and en.data = sa.data and en.previsao = sa.previsao
) t;

-- ============================================================
-- FUNÇÃO HELPER: pega o role do usuário logado
-- ============================================================
create or replace function public.current_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_cliente_id()
returns uuid
language sql
security definer
stable
as $$
  select cliente_id from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- RLS - ROW LEVEL SECURITY
-- ============================================================
alter table public.clientes enable row level security;
alter table public.profiles enable row level security;
alter table public.comboios enable row level security;
alter table public.descargas_barcacas enable row level security;
alter table public.navios enable row level security;
alter table public.saidas_navio enable row level security;
alter table public.quebras_tecnicas enable row level security;
alter table public.configuracoes enable row level security;

-- CLIENTES: todos autenticados podem ler; só admin escreve
create policy "clientes_select" on public.clientes for select
  using (auth.uid() is not null);
create policy "clientes_write_admin" on public.clientes for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- PROFILES: usuário vê o próprio perfil; admin vê todos
create policy "profiles_select_self_or_admin" on public.profiles for select
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles_update_self" on public.profiles for update
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles_insert_admin" on public.profiles for insert
  with check (public.current_user_role() = 'admin' or id = auth.uid());

-- COMBOIOS: admin/operação leem e escrevem; cliente não acessa diretamente
create policy "comboios_admin_operacao" on public.comboios for all
  using (public.current_user_role() in ('admin','operacao'))
  with check (public.current_user_role() in ('admin','operacao'));

-- DESCARGAS DE BARCAÇA: admin/operação full; cliente lê só o que é dele
create policy "descargas_admin_operacao_write" on public.descargas_barcacas for all
  using (public.current_user_role() in ('admin','operacao'))
  with check (public.current_user_role() in ('admin','operacao'));
create policy "descargas_cliente_select" on public.descargas_barcacas for select
  using (
    public.current_user_role() = 'cliente'
    and cliente_id = public.current_user_cliente_id()
  );

-- NAVIOS: admin/operação full; cliente lê só os seus
create policy "navios_admin_operacao_write" on public.navios for all
  using (public.current_user_role() in ('admin','operacao'))
  with check (public.current_user_role() in ('admin','operacao'));
create policy "navios_cliente_select" on public.navios for select
  using (
    public.current_user_role() = 'cliente'
    and cliente_id = public.current_user_cliente_id()
  );

-- SAÍDAS DE NAVIO: mesma lógica de navios
create policy "saidas_admin_operacao_write" on public.saidas_navio for all
  using (public.current_user_role() in ('admin','operacao'))
  with check (public.current_user_role() in ('admin','operacao'));
create policy "saidas_cliente_select" on public.saidas_navio for select
  using (
    public.current_user_role() = 'cliente'
    and cliente_id = public.current_user_cliente_id()
  );

-- QUEBRAS TÉCNICAS: admin/operação full; cliente lê só o seu
create policy "quebras_admin_operacao_write" on public.quebras_tecnicas for all
  using (public.current_user_role() in ('admin','operacao'))
  with check (public.current_user_role() in ('admin','operacao'));
create policy "quebras_cliente_select" on public.quebras_tecnicas for select
  using (
    public.current_user_role() = 'cliente'
    and cliente_id = public.current_user_cliente_id()
  );

-- CONFIGURAÇÕES: todos autenticados leem; só admin escreve
create policy "config_select" on public.configuracoes for select
  using (auth.uid() is not null);
create policy "config_write_admin" on public.configuracoes for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============================================================
-- TRIGGER: cria profile automaticamente ao cadastrar usuário no Auth
-- (role inicial = cliente; admin ajusta depois pelo painel)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, nome, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), 'cliente');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- DADOS INICIAIS (clientes do pool conforme a planilha)
-- ============================================================
insert into public.clientes (nome) values
  ('ADM'), ('COFCO'), ('BUNGE'), ('LDC')
on conflict (nome) do nothing;
