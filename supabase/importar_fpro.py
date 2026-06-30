"""
Importador do histórico FPRO.01 (planilha de navegação/estoque) para o
formato de tabelas do Supabase (terminal-graos-web).

LÓGICA IDENTIFICADA NA PLANILHA:
- Cada linha = um turno (1, 2 ou 3) de um dia. A coluna DATA só é
  preenchida na 1ª linha do dia; as demais ficam em branco (replicamos
  a última data vista = "forward fill").
- ENTRADAS (descarga de barcaças): colunas 14-21 trazem pares
  (Nº BG, toneladas) por cliente -- ADM, COFCO, BUNGE, LDC -- já
  descarregados naquele turno/dia. Isso é o que vira "descargas_barcacas".
- A coluna COMBOIO (4) e as colunas 6-9 (qtd de barcaças planejada por
  cliente) descrevem o comboio que ESTÁ chegando, não o que foi
  descarregado naquele turno. Por isso comboios são importados como um
  registro separado (informativo) e as descargas reais não são
  amarradas a um comboio específico (comboio_id fica nulo).
- SAÍDAS (navios): colunas 36-40 trazem o volume embarcado naquele
  turno/dia por cliente (ADM, COFCO, BUNGE, BUNGE/FREE, LDC). A coluna
  32 (nome do navio) só aparece na linha em que o navio é registrado/
  atracado -- as saídas dos dias seguintes não repetem o nome do navio.
  Por isso, assim como nas entradas, os navios viram um registro
  separado (informativo) e as saídas diárias não são amarradas a um
  navio específico (navio_id fica nulo) -- a menos que você queira
  revisar manualmente depois.
- Linhas com texto solto na coluna do navio (ex: "EMPRÉSTIMO BUNGE -6K",
  "DEVOLUÇÃO BUNGE +14K") são ajustes entre clientes do pool, não um
  navio -- são ignoradas no registro de navios e reportadas à parte.
- DATA CORTE: tudo com data <= 30/06/2026 entra como "realizado"
  (previsao = false). Datas depois disso entram como "previsao = true".

SAÍDA: gera 4 arquivos CSV prontos para importar nas tabelas do
Supabase (Table Editor -> Import data from CSV), na pasta
./importacao_csv/
"""

import csv
import os
from datetime import date

ENTRADA = "/mnt/user-data/uploads/FPRO_01.csv"
SAIDA_DIR = os.path.join(os.path.dirname(__file__), "importacao_csv")
os.makedirs(SAIDA_DIR, exist_ok=True)

DATA_CORTE = date(2026, 6, 30)
ANO_PADRAO = 2026

CLIENTES_ENTRADA = {14: ("ADM", 15), 16: ("COFCO", 17), 18: ("BUNGE", 19), 20: ("LDC", 21)}
CLIENTES_SAIDA = {36: "ADM", 37: "COFCO", 38: "BUNGE", 40: "LDC"}  # 39 = BUNGE/FREE, tratado à parte


def parse_num_ptbr(txt):
    txt = (txt or "").strip()
    if not txt:
        return None
    txt = txt.replace(".", "").replace(",", ".")
    try:
        return float(txt)
    except ValueError:
        return None


def parse_data_ddmm(txt, ano=ANO_PADRAO):
    txt = (txt or "").strip()
    if not txt or "/" not in txt:
        return None
    try:
        d, m = txt.split("/")
        return date(ano, int(m), int(d))
    except ValueError:
        return None


def main():
    with open(ENTRADA, encoding="latin1") as f:
        linhas = list(csv.reader(f, delimiter=";"))

    registros_entrada = []
    registros_saida = []
    registros_comboio = []
    registros_navio = []
    ajustes_ignorados = []

    data_atual = None
    navio_vigente = None  # nome do navio que está carregando no momento (até o próximo aparecer)
    comboio_vigente = None  # idem para comboios/descarga

    for r in linhas[4:]:  # pula as 4 linhas de cabeçalho
        if len(r) < 47:
            r = r + [""] * (47 - len(r))

        if r[0].strip():
            data_atual = parse_data_ddmm(r[0])
        if data_atual is None:
            continue

        turno = r[1].strip() or None
        previsao = data_atual > DATA_CORTE

        # ---------- COMBOIO (registro informativo + vigência p/ descarga) ----------
        comboio_nome = r[4].strip()
        if comboio_nome:
            produto = r[5].strip()
            registros_comboio.append({
                "nome": comboio_nome,
                "produto": "milho" if "MILHO" in produto.upper() else "soja",
                "data_referencia": data_atual.isoformat(),
                "qtd_bg_planejada": r[11].strip(),
                "qtd_ton_planejada": parse_num_ptbr(r[12]),
            })
            comboio_vigente = comboio_nome

        # ---------- ENTRADAS (descarga real por cliente) ----------
        for col_nbg, (cliente, col_ton) in CLIENTES_ENTRADA.items():
            ton = parse_num_ptbr(r[col_ton])
            if ton is None or ton == 0:
                continue
            registros_entrada.append({
                "cliente_nome": cliente,
                "data": data_atual.isoformat(),
                "hora": turno or "1",
                "numero_bg": r[col_nbg].strip(),
                "qtd_bg": ton,
                "previsao": previsao,
                "comboio_nome": comboio_vigente or "",
            })

        # ---------- NAVIO (registro informativo + vigência p/ saída) ----------
        navio_texto = r[32].strip()
        if navio_texto:
            eh_ajuste = any(p in navio_texto.upper() for p in ["EMPRÉSTIMO", "EMPRESTIMO", "DEVOLU"])
            if eh_ajuste:
                ajustes_ignorados.append({"data": data_atual.isoformat(), "texto": navio_texto})
            else:
                registros_navio.append({
                    "nome": navio_texto,
                    "eta_itacoatiara": parse_data_ddmm(r[30]).isoformat() if parse_data_ddmm(r[30]) else "",
                    "etb_novo_remanso": parse_data_ddmm(r[31]).isoformat() if parse_data_ddmm(r[31]) else "",
                    "produto": "milho" if "MILHO" in r[33].upper() else "soja",
                    "proprietario_cliente": r[34].strip(),
                    "volume_previsto": parse_num_ptbr(r[35]),
                })
                navio_vigente = navio_texto

        # ---------- SAÍDAS (carregamento real por cliente) ----------
        for col, cliente in CLIENTES_SAIDA.items():
            vol = parse_num_ptbr(r[col])
            if vol is None or vol == 0:
                continue
            registros_saida.append({
                "cliente_nome": cliente,
                "data": data_atual.isoformat(),
                "volume": vol,
                "previsao": previsao,
                "navio_nome": navio_vigente or "",
            })

        # BUNGE/FREE (col 39) -- somado ao cliente BUNGE, conforme confirmado
        vol_free = parse_num_ptbr(r[39])
        if vol_free:
            registros_saida.append({
                "cliente_nome": "BUNGE",
                "data": data_atual.isoformat(),
                "volume": vol_free,
                "previsao": previsao,
                "navio_nome": navio_vigente or "",
            })

    # ---------- grava CSVs ----------
    def gravar(nome, registros, campos):
        caminho = os.path.join(SAIDA_DIR, nome)
        with open(caminho, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=campos)
            w.writeheader()
            w.writerows(registros)
        print(f"{nome}: {len(registros)} linhas")

    gravar("descargas_barcacas.csv", registros_entrada,
           ["cliente_nome", "data", "hora", "numero_bg", "qtd_bg", "previsao", "comboio_nome"])
    gravar("saidas_navio.csv", registros_saida,
           ["cliente_nome", "data", "volume", "previsao", "navio_nome"])
    gravar("comboios_referencia.csv", registros_comboio,
           ["nome", "produto", "data_referencia", "qtd_bg_planejada", "qtd_ton_planejada"])
    gravar("navios_referencia.csv", registros_navio,
           ["nome", "eta_itacoatiara", "etb_novo_remanso", "produto", "proprietario_cliente", "volume_previsto"])
    gravar("ajustes_pool_ignorados.csv", ajustes_ignorados, ["data", "texto"])

    # ---------- resumo ----------
    total_entrada = sum(x["qtd_bg"] for x in registros_entrada)
    total_saida = sum(x["volume"] for x in registros_saida)
    print()
    print(f"Total descarregado (entradas): {total_entrada:,.2f} t")
    print(f"Total embarcado (saídas):      {total_saida:,.2f} t")
    print(f"Saldo resultante:              {total_entrada - total_saida:,.2f} t")
    print(f"Comboios distintos referenciados: {len(set(c['nome'] for c in registros_comboio))}")
    print(f"Navios distintos referenciados:   {len(set(n['nome'] for n in registros_navio))}")
    print(f"Ajustes de pool ignorados (empréstimo/devolução): {len(ajustes_ignorados)}")


if __name__ == "__main__":
    main()
