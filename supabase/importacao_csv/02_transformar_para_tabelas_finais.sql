-- ============================================================
-- TRANSFORMAÇÃO: staging -> tabelas finais do sistema
-- Rode DEPOIS de importar os 4 CSVs nas tabelas staging_* pelo
-- Table Editor do Supabase (Import data from CSV)
-- ============================================================

-- 1) Garante que os clientes citados na planilha existem
insert into public.clientes (nome)
select distinct cliente_nome from staging_descargas
where cliente_nome is not null and cliente_nome <> ''
on conflict (nome) do nothing;

insert into public.clientes (nome)
select distinct cliente_nome from staging_saidas
where cliente_nome is not null and cliente_nome <> ''
on conflict (nome) do nothing;

-- 2) Cria os comboios de referência (um registro por nome distinto)
insert into public.comboios (nome, produto, data_saida_pvh)
select distinct on (nome) nome, produto::produto_tipo, data_referencia
from staging_comboios
order by nome, data_referencia asc
on conflict do nothing;

-- 3) Cria os navios de referência (um registro por nome distinto)
insert into public.navios (nome, cliente_id, produto, eta_itacoatiara, etb_novo_remanso, volume_previsto, status)
select distinct on (sn.nome)
  sn.nome,
  c.id,
  sn.produto::produto_tipo,
  sn.eta_itacoatiara,
  sn.etb_novo_remanso,
  coalesce(sn.volume_previsto, 0),
  'concluido'::navio_status
from staging_navios sn
left join public.clientes c on c.nome = sn.proprietario_cliente
order by sn.nome, sn.eta_itacoatiara asc nulls last
on conflict do nothing;

-- 4) Importa as descargas de barcaças (entradas), já vinculadas ao
--    cliente e, quando identificável, ao comboio
insert into public.descargas_barcacas (cliente_id, comboio_id, data, hora, numero_bg, qtd_bg, previsao)
select
  c.id,
  cb.id,
  sd.data,
  coalesce(sd.hora, 1),
  nullif(sd.numero_bg, ''),
  sd.qtd_bg,
  sd.previsao
from staging_descargas sd
join public.clientes c on c.nome = sd.cliente_nome
left join public.comboios cb on cb.nome = sd.comboio_nome;

-- 5) Importa as saídas (carregamento de navios), já vinculadas ao
--    cliente e, quando identificável, ao navio
insert into public.saidas_navio (cliente_id, navio_id, data, volume, previsao)
select
  c.id,
  n.id,
  ss.data,
  ss.volume,
  ss.previsao
from staging_saidas ss
join public.clientes c on c.nome = ss.cliente_nome
left join public.navios n on n.nome = ss.navio_nome;

-- 6) Limpa as tabelas temporárias (opcional - rode só depois de
--    conferir que tudo importou certo)
-- drop table staging_descargas;
-- drop table staging_saidas;
-- drop table staging_comboios;
-- drop table staging_navios;

-- 7) Conferência rápida
select 'descargas_barcacas' as tabela, count(*) as linhas, sum(qtd_bg) as total_ton from public.descargas_barcacas
union all
select 'saidas_navio', count(*), sum(volume) from public.saidas_navio
union all
select 'comboios', count(*), null from public.comboios
union all
select 'navios', count(*), null from public.navios;
