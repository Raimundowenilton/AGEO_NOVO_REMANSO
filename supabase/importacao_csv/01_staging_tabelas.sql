-- ============================================================
-- TABELAS TEMPORÁRIAS (STAGING) PARA IMPORTAÇÃO DO HISTÓRICO FPRO.01
-- Rode este script ANTES de importar os CSVs pelo Table Editor do Supabase
-- ============================================================

create table if not exists staging_descargas (
  cliente_nome text,
  data date,
  hora int,
  numero_bg text,
  qtd_bg numeric,
  previsao boolean,
  comboio_nome text
);

create table if not exists staging_saidas (
  cliente_nome text,
  data date,
  volume numeric,
  previsao boolean,
  navio_nome text
);

create table if not exists staging_comboios (
  nome text,
  produto text,
  data_referencia date,
  qtd_bg_planejada text,
  qtd_ton_planejada numeric
);

create table if not exists staging_navios (
  nome text,
  eta_itacoatiara date,
  etb_novo_remanso date,
  produto text,
  proprietario_cliente text,
  volume_previsto numeric
);
