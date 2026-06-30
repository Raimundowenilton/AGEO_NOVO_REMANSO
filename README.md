# Terminal Novo Remanso — Controle de Estoque (AGEO)

App web único (HTML + CSS + JS direto, sem framework) conectado ao
Supabase — mesmo formato do DRE Gerencial. Controla entradas de barcaças
vindas de Porto Velho, saídas de navios e projeta o estoque dia a dia,
com controle de acesso por perfil (admin / operação / cliente) e
identidade visual AGEO.

## Estrutura
```
index.html      → toda a interface (login + telas do app)
style.css       → identidade visual AGEO (cores, layout)
app.js          → toda a lógica: autenticação, navegação, previsão de estoque
config.js       → chaves do Supabase (preencher antes de publicar)
manifest.json   → PWA (instalar como app no celular/desktop)
sw.js           → service worker (funciona offline para a interface)
assets/         → logos AGEO (colorido e branco) e ícones do PWA
supabase/schema.sql → script para criar todo o banco de dados
```

## Como funciona o controle de estoque
- **Entradas**: cada descarga de barcaça é lançada vinculada a um cliente
  do pool (ADM, COFCO, BUNGE, LDC...) e a um comboio. Pode ser marcada
  como **previsão** (ainda vai acontecer) ou **realizado**.
- **Saídas**: cada navio é programado com ETA/ETB e volume previsto; o
  carregamento efetivo é lançado em "saídas", também podendo ser
  previsão ou realizado.
- **Estoque atual**: soma de tudo que é `realizado` (entradas − saídas −
  quebra técnica), por cliente e total do terminal.
- **Previsão de estoque**: o dashboard projeta a curva de estoque dia a
  dia somando realizado + previsão, e avisa se em algum dia futuro o
  total ultrapassa a capacidade de 85.000 t do armazém.

## Perfis de acesso
| Perfil | Pode fazer |
|---|---|
| `admin` | Tudo: cadastra clientes, define perfis de usuário, lança entradas/saídas |
| `operacao` | Lança entradas e saídas, vê dashboard completo |
| `cliente` | Só visualiza o próprio saldo/estoque |

O controle é reforçado por **Row Level Security (RLS)** no banco — não
depende só da interface.

## Passo a passo para colocar no ar

### 1. Criar o projeto no Supabase
1. Crie um projeto em https://supabase.com
2. Vá em **SQL Editor** e rode o conteúdo de `supabase/schema.sql`
3. Em **Authentication → Providers**, deixe **Email** habilitado
4. Em **Project Settings → API**, copie a `URL` e a `anon public key`

### 2. Configurar as chaves
Edite `config.js`:
```js
const SUPABASE_URL = "https://seu-projeto.supabase.co";
const SUPABASE_ANON_KEY = "sua-anon-key";
```

### 3. Criar o primeiro usuário (admin)
No painel do Supabase: **Authentication → Users → Add user**. Faça o
primeiro login no app (ele entra como "cliente" por padrão) e depois
rode no SQL Editor:
```sql
update public.profiles set role = 'admin' where nome = 'seuemail@empresa.com';
```
Depois disso, esse usuário admin cria/ajusta os demais perfis direto
pela tela **Clientes e Usuários** do sistema.

### 4. Publicar no Vercel (igual ao DRE Gerencial)
- Suba esta pasta para um repositório no GitHub
- No Vercel, importe o repositório como projeto estático (sem build
  necessário — é HTML puro)
- Pronto, fica com uma URL pública como `terminal-nr.vercel.app`

## Identidade visual AGEO usada
- Verde principal: `#4F904C` / `#51B24F` / `#5B9A58`
- Verde-limão (destaque): `#AFD248`
- Cinzas: `#58595B` / `#747575` / `#A6AAA9` / `#E6E6E6`
- Laranja: `#EE8133` · Amarelo: `#F3B33E` · Azul-marinho (topo): `#333B5A`
- Logo: `assets/ageo-logo-color.png` (fundo claro) e
  `assets/ageo-logo-white.png` (fundo escuro)

## Ajustar a capacidade do armazém
```sql
update public.configuracoes set capacidade_total_ton = 90000 where id = 1;
```

## Próximos passos sugeridos
- Importar o histórico da planilha FPRO.01 para o sistema já nascer com
  saldo correto (separando o que já foi realizado do que ainda é
  previsão).
- Lógica de rateio automático do pool ANEC (dividir a carga de um navio
  entre os clientes conforme regra do pool).
- Relatório de quebra técnica por cliente com gráfico de tendência.
