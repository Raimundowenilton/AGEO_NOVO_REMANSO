# Passo a passo — Publicar o sistema e importar o histórico FPRO.01

## PARTE 1 — Criar e configurar o Supabase

1. Acesse https://supabase.com e crie uma conta (ou faça login).
2. Clique em **New Project**.
   - Nome: `terminal-novo-remanso` (ou o que preferir)
   - Senha do banco: anote em local seguro, vai precisar depois
   - Região: escolha a mais próxima (ex: South America - São Paulo)
3. Aguarde uns 2 minutos até o projeto ficar pronto.
4. No menu lateral, vá em **SQL Editor** → **New query**.
5. Abra o arquivo `supabase/schema.sql` (deste pacote), copie todo o
   conteúdo, cole no editor e clique em **Run**.
   - Isso cria todas as tabelas, views de estoque e as regras de
     segurança (RLS) por perfil.
6. Vá em **Project Settings** (ícone de engrenagem) → **API**.
   - Copie a **Project URL**
   - Copie a **anon public key**
   - Guarde os dois — vai usar no Passo 2.

## PARTE 2 — Configurar as chaves no projeto

1. Abra o arquivo `config.js` (na raiz do pacote) em qualquer editor de
   texto.
2. Substitua:
   ```js
   const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
   const SUPABASE_ANON_KEY = "SUA-ANON-KEY";
   ```
   pelos valores que você copiou no Passo 1.6.
3. Salve o arquivo.

## PARTE 3 — Criar o primeiro usuário (você, como admin)

1. No Supabase, vá em **Authentication** → **Users** → **Add user** →
   **Create new user**.
2. Preencha seu e-mail e uma senha. Marque "Auto Confirm User" para não
   precisar confirmar por e-mail.
3. Volte no **SQL Editor**, rode:
   ```sql
   update public.profiles set role = 'admin'
   where nome = 'seuemail@empresa.com';
   ```
   (troque pelo e-mail que você cadastrou — ele vira o "nome" do perfil
   automaticamente no primeiro login).

   > Se der "0 rows affected", é porque o perfil só é criado no
   > primeiro login pelo site. Nesse caso, pule para a Parte 4, faça
   > login uma vez, e só depois rode esse UPDATE.

## PARTE 4 — Publicar no Vercel

1. Crie uma conta em https://vercel.com (pode entrar com GitHub).
2. **Opção mais simples (sem GitHub):**
   - Instale a CLI: abra um terminal e rode `npm install -g vercel`
   - Dentro da pasta do projeto (`terminal-graos-web`), rode `vercel`
   - Siga as perguntas (aceite as opções padrão) — ele te dá uma URL
     pública tipo `terminal-graos-web.vercel.app`
3. **Opção com GitHub (recomendada para manter atualizações fáceis,
   igual ao DRE Gerencial):**
   - Crie um repositório novo no GitHub (ex: `terminal-novo-remanso`)
   - Suba os arquivos desta pasta para o repositório
   - No Vercel, clique em **Add New** → **Project** → selecione o
     repositório
   - Como é HTML puro, não precisa configurar build — clique em
     **Deploy**
4. Pronto — acesse a URL gerada e faça login com o usuário criado na
   Parte 3.

## PARTE 5 — Importar o histórico da planilha FPRO.01

Já gerei os arquivos prontos na pasta `supabase/importacao_csv/`:
- `descargas_barcacas.csv` (228 lançamentos de entrada)
- `saidas_navio.csv` (200 lançamentos de saída)
- `comboios_referencia.csv` (81 comboios)
- `navios_referencia.csv` (41 navios)
- `ajustes_pool_ignorados.csv` (60 ajustes entre clientes — não
  importados, fica só de registro)

Siga nesta ordem:

### 5.1 Criar as tabelas temporárias
No **SQL Editor** do Supabase, rode o conteúdo de
`supabase/importacao_csv/01_staging_tabelas.sql`.

### 5.2 Importar os 4 CSVs
No menu lateral, vá em **Table Editor**. Para cada uma das 4 tabelas
que acabou de criar (`staging_descargas`, `staging_saidas`,
`staging_comboios`, `staging_navios`):
1. Clique na tabela
2. Clique em **Insert** → **Import data from CSV**
3. Selecione o arquivo CSV correspondente (mesmo nome da tabela, sem o
   prefixo `staging_`)
4. Confirme o mapeamento de colunas (deve vir automático, pois os
   nomes batem) e importe

### 5.3 Rodar a transformação final
Volte no **SQL Editor** e rode o conteúdo de
`supabase/importacao_csv/02_transformar_para_tabelas_finais.sql`.

Esse script:
- Garante que ADM, COFCO, BUNGE e LDC existem como clientes
- Cria o cadastro de comboios e navios
- Importa as 228 entradas e 200 saídas já vinculadas ao cliente certo
  e, quando identificável, ao navio/comboio certo
- No final, mostra uma tabela de conferência com o total de linhas e
  toneladas importadas — confira se bate com:
  - Entradas: ~1.667.689 t
  - Saídas: ~1.652.223 t
  - Saldo: ~15.466 t

Se os números baterem, está tudo certo. Se quiser, depois disso pode
apagar as tabelas `staging_*` (tem os comandos comentados no final do
script).

## Resumo do que foi assumido na importação
- Cada navio "puxa" os carregamentos diários seguintes até o próximo
  navio aparecer na planilha (confirmado com você usando o exemplo do
  MV Reliable).
- O mesmo vale para comboios e as descargas de barcaça.
- A coluna "BUNGE/FREE" foi somada ao cliente BUNGE.
- As 60 linhas de empréstimo/devolução entre clientes do pool ficaram
  de fora (estão listadas em `ajustes_pool_ignorados.csv` caso queira
  lançar manualmente depois).
- Datas até 30/06/2026 entraram como "realizado"; depois disso, como
  "previsão".
