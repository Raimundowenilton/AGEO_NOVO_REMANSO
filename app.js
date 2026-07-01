// ============================================================
// Terminal Novo Remanso — App único (estilo DRE Gerencial)
// ============================================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const APP_VERSION = "5.0";
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("versao-numero");
  if (el) el.textContent = APP_VERSION;
});

// ---------------- MOSTRAR/OCULTAR SENHA ----------------
document.getElementById("btn-mostrar-senha").addEventListener("click", () => {
  const campo = document.getElementById("login-senha");
  const btn = document.getElementById("btn-mostrar-senha");
  const oculto = campo.type === "password";
  campo.type = oculto ? "text" : "password";
  btn.textContent = oculto ? "🙈" : "👁";
});

let PERFIL = null; // { id, nome, role, cliente_id }
let CLIENTES = [];
let CAPACIDADE_TOTAL = 85000;
let GRAFICO = null;

const VIEWS = {
  dashboard: { label: "Estoque", roles: ["admin", "operacao", "cliente"] },
  pool: { label: "Programação do Pool", roles: ["admin", "operacao"] },
  lineup: { label: "LINE-UP", roles: ["admin", "operacao"] },
  timeline: { label: "Linha do Tempo", roles: ["admin", "operacao", "cliente"] },
  entradas: { label: "Entradas (Barcaças)", roles: ["admin", "operacao"] },
  saidas: { label: "Saídas (Navios)", roles: ["admin", "operacao"] },
  capacidade: { label: "Cotas de Armazém", roles: ["admin"] },
  clientes: { label: "Clientes e Usuários", roles: ["admin"] },
};

// ---------------- PWA ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---------------- INICIALIZAÇÃO ----------------
document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await iniciarApp();
  } else {
    mostrarLogin();
  }
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const senha = document.getElementById("login-senha").value;
  const erroEl = document.getElementById("login-erro");
  const btn = document.getElementById("btn-login");

  erroEl.classList.add("oculto");
  btn.disabled = true;
  btn.textContent = "Entrando...";

  const { error } = await sb.auth.signInWithPassword({ email, password: senha });

  btn.disabled = false;
  btn.textContent = "Entrar";

  if (error) {
    erroEl.textContent = "E-mail ou senha inválidos.";
    erroEl.classList.remove("oculto");
    return;
  }

  await iniciarApp();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

function mostrarLogin() {
  document.getElementById("tela-login").classList.remove("oculto");
  document.getElementById("app").classList.add("oculto");
}

// ---------------- BOOT DO APP PÓS-LOGIN ----------------
async function iniciarApp() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { mostrarLogin(); return; }

  const { data: perfil, error } = await sb
    .from("profiles")
    .select("id, nome, role, cliente_id")
    .eq("id", user.id)
    .single();

  if (error || !perfil) { mostrarLogin(); return; }

  PERFIL = perfil;

  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");
  document.getElementById("usuario-info").textContent = `${perfil.nome} · ${perfil.role}`;

  montarNavegacao();
  await carregarClientes();
  await carregarConfiguracoes();
  irPara("dashboard");
}

function montarNavegacao() {
  const nav = document.getElementById("nav-links");
  nav.innerHTML = "";
  Object.entries(VIEWS).forEach(([chave, info]) => {
    if (!info.roles.includes(PERFIL.role)) return;
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = info.label;
    a.dataset.view = chave;
    a.addEventListener("click", (e) => { e.preventDefault(); irPara(chave); });
    nav.appendChild(a);
  });
}

function irPara(chave) {
  Object.keys(VIEWS).forEach((v) => {
    document.getElementById(`view-${v}`)?.classList.add("oculto");
  });
  document.getElementById(`view-${chave}`)?.classList.remove("oculto");

  document.querySelectorAll("#nav-links a").forEach((a) => {
    a.classList.toggle("ativo", a.dataset.view === chave);
  });

  if (chave === "dashboard") carregarDashboard();
  if (chave === "pool") carregarPoolDashboard();
  if (chave === "lineup") carregarLineup();
  if (chave === "timeline") carregarTimeline();
  if (chave === "entradas") carregarEntradas();
  if (chave === "saidas") carregarSaidas();
  if (chave === "capacidade") carregarCapacidade();
  if (chave === "clientes") carregarClientesUsuarios();
}

// ---------------- DADOS BASE ----------------
async function carregarClientes() {
  const { data } = await sb.from("clientes").select("id, nome").eq("ativo", true).order("nome");
  CLIENTES = data ?? [];

  // preenche os <select> de cliente dos formulários (obrigatório escolher)
  ["ent-cliente", "nv-cliente", "sd-cliente"].forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione</option>' +
      CLIENTES.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("");
  });

  // select de filtro da timeline (tem opção "Todos")
  const selTl = document.getElementById("tl-cliente");
  if (selTl) {
    selTl.innerHTML = '<option value="">Todos</option>' +
      CLIENTES.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("");
  }
}

async function carregarConfiguracoes() {
  const { data } = await sb.from("configuracoes").select("capacidade_total_ton").eq("id", 1).single();
  CAPACIDADE_TOTAL = data?.capacidade_total_ton ?? 85000;
}

// ---------------- DASHBOARD / PREVISÃO DE ESTOQUE ----------------
let MOVIMENTOS_POR_CLIENTE_CACHE = []; // cache completo com cliente_id para cálculo por data

async function carregarDashboard() {
  const { data: naviosAtivos } = await sb.from("navios")
    .select("volume_previsto, cliente_id")
    .in("status", ["previsto", "atracado", "carregando"]);

  // Busca TODOS os movimentos com info de cliente (para calcular saldo por data)
  const { data: todasEntradas } = await sb.from("descargas_barcacas")
    .select("cliente_id, data, previsao, qtd_bg, clientes(nome, id)");
  const { data: todasSaidas } = await sb.from("saidas_navio")
    .select("cliente_id, data, previsao, volume, clientes(nome, id)");

  // Monta cache de movimentos por cliente (Item 1)
  MOVIMENTOS_POR_CLIENTE_CACHE = [
    ...(todasEntradas ?? []).map(e => ({
      cliente_id: e.cliente_id,
      cliente_nome: e.clientes?.nome,
      data: e.data, previsao: e.previsao,
      entrada: Number(e.qtd_bg), saida: 0
    })),
    ...(todasSaidas ?? []).map(s => ({
      cliente_id: s.cliente_id,
      cliente_nome: s.clientes?.nome,
      data: s.data, previsao: s.previsao,
      entrada: 0, saida: Number(s.volume)
    })),
  ];

  // KPIs gerais (usando data de hoje como base)
  const hoje = new Date().toISOString().slice(0, 10);
  const totalRealizadoHoje = MOVIMENTOS_POR_CLIENTE_CACHE
    .filter(m => !m.previsao && m.data <= hoje)
    .reduce((a, m) => a + m.entrada - m.saida, 0);

  const volumeRetido = (naviosAtivos ?? []).reduce((acc, n) => acc + Number(n.volume_previsto), 0);
  const saldoLivre = totalRealizadoHoje - volumeRetido;
  const ocupacao = CAPACIDADE_TOTAL ? Math.round((totalRealizadoHoje / CAPACIDADE_TOTAL) * 1000) / 10 : 0;

  document.getElementById("kpi-estoque").textContent = formatarTon(totalRealizadoHoje);
  document.getElementById("kpi-capacidade").textContent = formatarTon(CAPACIDADE_TOTAL);
  const kpiOcupacao = document.getElementById("kpi-ocupacao");
  kpiOcupacao.textContent = `${ocupacao}%`;
  kpiOcupacao.classList.toggle("alerta-vermelho", ocupacao > 95);

  const kpiRetencao = document.getElementById("kpi-retencao");
  const kpiLivre = document.getElementById("kpi-livre");
  if (kpiRetencao) kpiRetencao.textContent = formatarTon(volumeRetido);
  if (kpiLivre) {
    kpiLivre.textContent = formatarTon(saldoLivre);
    kpiLivre.style.color = saldoLivre < 0 ? "#ff5252" : "var(--lima)";
  }

  // Cache de navios retidos por cliente
  window._RETENCAO_POR_CLIENTE = {};
  (naviosAtivos ?? []).forEach(n => {
    window._RETENCAO_POR_CLIENTE[n.cliente_id] = (window._RETENCAO_POR_CLIENTE[n.cliente_id] ?? 0) + Number(n.volume_previsto);
  });

  // Gráfico (todos os movimentos agregados)
  const movimentos = MOVIMENTOS_POR_CLIENTE_CACHE.map(m => ({
    data: m.data, previsao: m.previsao, entrada: m.entrada, saida: m.saida
  }));
  const { pontos: todosPontos, alertaCapacidade } = projetarEstoque(movimentos, CAPACIDADE_TOTAL);
  PONTOS_ESTOQUE_CACHE = todosPontos;

  const periodoSelecionado = document.getElementById("grafico-periodo")?.value ?? "60";
  filtrarEDesenharGrafico(todosPontos, Number(periodoSelecionado));

  if (!document.getElementById("data-consulta").value) {
    document.getElementById("data-consulta").value = hoje;
  }
  atualizarEstoqueNaData();

  const alertaEl = document.getElementById("alerta-capacidade");
  if (alertaCapacidade) {
    alertaEl.classList.remove("oculto");
    alertaEl.innerHTML = `⚠ Atenção: pela previsão atual, o estoque ultrapassa a capacidade do armazém em
      <strong>${fmtData(alertaCapacidade.data)}</strong>
      (projeção: ${formatarTon(alertaCapacidade.estoqueProjetado)}). Reavalie a programação de navios ou de comboios.`;
  } else {
    alertaEl.classList.add("oculto");
  }
}

// Atualiza tabela de clientes com base na data selecionada (Item 1)
function atualizarTabelaClientesPorData(dataSelecionada) {
  const porCliente = {};

  MOVIMENTOS_POR_CLIENTE_CACHE.forEach(m => {
    if (!m.cliente_id || !m.cliente_nome) return;
    if (m.data > dataSelecionada) return; // só até a data selecionada
    // Item 4: ignora cliente alafan
    if (m.cliente_nome.includes("@") || m.cliente_nome.includes(".com")) return;

    if (!porCliente[m.cliente_id]) {
      porCliente[m.cliente_id] = { nome: m.cliente_nome, entrada: 0, saida: 0 };
    }
    porCliente[m.cliente_id].entrada += m.entrada;
    porCliente[m.cliente_id].saida += m.saida;
  });

  const tbody = document.getElementById("tbody-saldo-cliente");
  let totE = 0, totS = 0, totSaldo = 0, totRet = 0;

  const linhas = Object.entries(porCliente)
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome))
    .map(([id, c]) => {
      const saldo = c.entrada - c.saida;
      const retencao = window._RETENCAO_POR_CLIENTE?.[id] ?? 0;
      const livre = saldo - retencao;
      totE += c.entrada; totS += c.saida; totSaldo += saldo; totRet += retencao;
      return `<tr>
        <td style="font-weight:600">${c.nome}</td>
        <td>${formatarTon(c.entrada)}</td>
        <td>${formatarTon(c.saida)}</td>
        <td>0 t</td>
        <td style="color:${saldo < 0 ? "#ff5252" : "var(--lima)"};font-weight:600">${formatarTon(saldo)}</td>
        <td style="color:var(--laranja)">${formatarTon(retencao)}</td>
        <td style="color:${livre < 0 ? "#ff5252" : "var(--lima)"};font-weight:700">${formatarTon(livre)}</td>
      </tr>`;
    }).join("");

  tbody.innerHTML = linhas + `<tr style="border-top:1px solid var(--painel-borda);font-weight:700;background:rgba(255,255,255,0.03)">
    <td>TOTAL</td>
    <td>${formatarTon(totE)}</td>
    <td>${formatarTon(totS)}</td>
    <td>0 t</td>
    <td style="color:${totSaldo < 0 ? "#ff5252" : "var(--lima)"}">${formatarTon(totSaldo)}</td>
    <td style="color:var(--laranja)">${formatarTon(totRet)}</td>
    <td style="color:${(totSaldo - totRet) < 0 ? "#ff5252" : "var(--lima)"}">${formatarTon(totSaldo - totRet)}</td>
  </tr>`;
}

// filtra os pontos por período e desenha o gráfico
function filtrarEDesenharGrafico(todosPontos, diasTotal) {
  const hoje = new Date();
  const de = new Date(hoje);
  de.setDate(de.getDate() - Math.round(diasTotal * 0.5));
  const ate = new Date(hoje);
  ate.setDate(ate.getDate() + Math.round(diasTotal * 0.5));

  const pontosFiltrados = todosPontos.filter(p => {
    const d = new Date(p.data);
    return d >= de && d <= ate;
  });

  desenharGrafico(pontosFiltrados.length > 0 ? pontosFiltrados : todosPontos);
}

// soma movimentos por data e projeta o saldo acumulado dia a dia
function projetarEstoque(movimentos, capacidadeTotal) {
  const porData = new Map();
  for (const m of movimentos) {
    const atual = porData.get(m.data) ?? { entrada: 0, saida: 0, realizado: true };
    atual.entrada += m.entrada;
    atual.saida += m.saida;
    if (m.previsao) atual.realizado = false;
    porData.set(m.data, atual);
  }

  const datas = Array.from(porData.keys()).sort();
  let saldo = 0;
  let alertaCapacidade = null;
  const pontos = datas.map((data) => {
    const { entrada, saida, realizado } = porData.get(data);
    saldo += entrada - saida;
    const ponto = { data, estoqueProjetado: saldo, realizado };
    if (!alertaCapacidade && saldo > capacidadeTotal) alertaCapacidade = ponto;
    return ponto;
  });

  return { pontos, alertaCapacidade };
}

function desenharGrafico(pontos) {
  const ctx = document.getElementById("grafico-estoque");
  const labels = pontos.map((p) => new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  const valores = pontos.map((p) => Math.round(p.estoqueProjetado));

  if (GRAFICO) GRAFICO.destroy();
  GRAFICO = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Estoque (t)",
          data: valores,
          borderColor: "#AFD248",
          backgroundColor: "rgba(175,210,72,0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: "Capacidade máxima",
          data: valores.map(() => CAPACIDADE_TOTAL),
          borderColor: "#ff6b6b",
          borderDash: [6, 6],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#9aa39b" } } },
      scales: {
        x: { ticks: { color: "#9aa39b" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#9aa39b" }, grid: { color: "rgba(255,255,255,0.05)" } },
      },
    },
  });
}

function formatarTon(v) {
  return `${Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} t`;
}

// Bug 4: formata data sem conversão de timezone (evita o "dia -1")
function fmtData(dataStr) {
  if (!dataStr) return "-";
  const [ano, mes, dia] = dataStr.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------------- BOTÃO SYNC LOGONE NO DASHBOARD ----------------
document.getElementById("btn-sync-dashboard").addEventListener("click", async () => {
  const btn = document.getElementById("btn-sync-dashboard");
  const msg = document.getElementById("sync-dashboard-msg");
  btn.disabled = true;
  btn.textContent = "⏳ Sincronizando...";
  msg.textContent = "Conectando ao Logone via tgsa-ai...";

  try {
    const res = await fetch("https://logone-sync-ageo.vercel.app/api/sync", {
      method: "POST",
      headers: { "x-disparado-por": "manual" },
    });
    const data = await res.json();
    if (data.ok) {
      msg.style.color = "var(--verde-2)";
      msg.textContent = `✅ ${data.entradas_gravadas} entradas e ${data.saidas_gravadas} saídas sincronizadas${data.duplicados > 0 ? ` (${data.duplicados} duplicatas ignoradas)` : ""}`;
      carregarDashboard();
    } else {
      msg.style.color = "#ff5252";
      msg.textContent = `❌ Erro: ${data.erro}`;
    }
  } catch (e) {
    msg.style.color = "#ff5252";
    msg.textContent = `❌ Erro de conexão com o conector Logone`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Sincronizar Logone";
  }
});

// Seletor de período do gráfico
document.getElementById("grafico-periodo").addEventListener("change", (e) => {
  if (PONTOS_ESTOQUE_CACHE.length > 0) {
    filtrarEDesenharGrafico(PONTOS_ESTOQUE_CACHE, Number(e.target.value));
  }
});

// ---------------- CONSULTA DE ESTOQUE POR DATA ----------------
let PONTOS_ESTOQUE_CACHE = [];

document.getElementById("data-consulta").addEventListener("change", atualizarEstoqueNaData);
document.getElementById("data-anterior").addEventListener("click", () => mudarDataConsulta(-1));
document.getElementById("data-seguinte").addEventListener("click", () => mudarDataConsulta(1));
document.getElementById("data-hoje").addEventListener("click", () => {
  document.getElementById("data-consulta").value = new Date().toISOString().slice(0, 10);
  atualizarEstoqueNaData();
});

function mudarDataConsulta(deltaDias) {
  const campo = document.getElementById("data-consulta");
  const data = new Date(campo.value + "T00:00:00");
  data.setDate(data.getDate() + deltaDias);
  campo.value = data.toISOString().slice(0, 10);
  atualizarEstoqueNaData();
}

function atualizarEstoqueNaData() {
  const dataSelecionada = document.getElementById("data-consulta").value;
  const kpiEl = document.getElementById("kpi-estoque-data");
  if (!dataSelecionada || PONTOS_ESTOQUE_CACHE.length === 0) {
    kpiEl.textContent = "--";
    return;
  }

  let valor = 0;
  let achouPosterior = false;
  for (const p of PONTOS_ESTOQUE_CACHE) {
    if (p.data <= dataSelecionada) {
      valor = p.estoqueProjetado;
    } else {
      achouPosterior = true;
      break;
    }
  }

  kpiEl.textContent = formatarTon(valor);
  kpiEl.classList.toggle("alerta-vermelho", valor > CAPACIDADE_TOTAL);

  // Atualiza tabela de clientes com base na data selecionada (Item 1)
  if (MOVIMENTOS_POR_CLIENTE_CACHE.length > 0) {
    atualizarTabelaClientesPorData(dataSelecionada);
  }

  const ultimoPonto = PONTOS_ESTOQUE_CACHE[PONTOS_ESTOQUE_CACHE.length - 1];
  if (ultimoPonto && dataSelecionada > ultimoPonto.data && !achouPosterior) {
    kpiEl.title = `Sem lançamentos previstos após ${fmtData(ultimoPonto.data)} — valor mantido.`;
  } else {
    kpiEl.title = "";
  }
}

// ---------------- ENTRADAS ----------------
document.getElementById("form-entrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById("ent-msg");
  msgEl.textContent = "Salvando...";

  let comboioId = null;
  const nomeComboio = document.getElementById("ent-comboio").value.trim();
  if (nomeComboio) {
    const { data: comboio, error: erroComboio } = await sb
      .from("comboios")
      .insert({ nome: nomeComboio, produto: document.getElementById("ent-produto").value })
      .select("id").single();
    if (erroComboio) { msgEl.textContent = "Erro ao registrar comboio: " + erroComboio.message; return; }
    comboioId = comboio.id;
  }

  const { error } = await sb.from("descargas_barcacas").insert({
    comboio_id: comboioId,
    cliente_id: document.getElementById("ent-cliente").value,
    data: document.getElementById("ent-data").value,
    hora: Number(document.getElementById("ent-turno").value),
    numero_bg: document.getElementById("ent-numero-bg").value || null,
    qtd_bg: Number(document.getElementById("ent-qtd").value),
    previsao: document.getElementById("ent-previsao").checked,
  });

  if (error) { msgEl.textContent = "Erro ao salvar: " + error.message; return; }

  msgEl.textContent = "Entrada registrada com sucesso.";
  document.getElementById("ent-comboio").value = "";
  document.getElementById("ent-numero-bg").value = "";
  document.getElementById("ent-qtd").value = "";
  carregarEntradas();
});

async function carregarEntradas() {
  if (!document.getElementById("ent-data").value) {
    document.getElementById("ent-data").value = new Date().toISOString().slice(0, 10);
  }
  // Item 2: busca APENAS os lançamentos previstos (não realizados)
  const { data } = await sb
    .from("descargas_barcacas")
    .select("id, data, hora, numero_bg, qtd_bg, previsao, produto, cliente_id, clientes(nome), comboios(nome, id)")
    .neq("previsao", false)
    .order("data", { ascending: true });

  CACHE_ENTRADAS = data ?? [];

  const tbody = document.getElementById("tbody-entradas");
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--texto-fraco);padding:16px;text-align:center">Nenhuma entrada prevista cadastrada. Lançamentos realizados vêm do Logone automaticamente.</td></tr>`;
    return;
  }

  tbody.innerHTML = (data ?? []).map((l) => `
    <tr>
      <td>${fmtData(l.data)}</td>
      <td>${l.hora}</td>
      <td>${l.clientes?.nome ?? "-"}</td>
      <td>${l.comboios?.nome || l.numero_bg || "-"}</td>
      <td>${Number(l.qtd_bg).toLocaleString("pt-BR")}</td>
      <td style="text-transform:capitalize">${l.produto ?? "soja"}</td>
      <td class="status-previsao">Previsão</td>
      <td style="display:flex;gap:4px">
        <button class="btn-editar" onclick="editarEntradaPorId('${l.id}')">Editar</button>
        <button class="btn-editar" style="color:#ff5252;border-color:#ff5252" onclick="excluirEntrada('${l.id}')">Excluir</button>
      </td>
    </tr>
  `).join("");
}

let CACHE_ENTRADAS = [];
function editarEntradaPorId(id) {
  const registro = CACHE_ENTRADAS.find((r) => r.id === id);
  if (registro) abrirModalEdicaoEntrada(registro);
}

async function excluirEntrada(id) {
  if (!confirm("Excluir esta entrada prevista?")) return;
  const { error } = await sb.from("descargas_barcacas").delete().eq("id", id);
  if (error) { alert("Erro ao excluir: " + error.message); return; }
  carregarEntradas();
  carregarDashboard();
}

// ---------------- SAÍDAS ----------------
document.getElementById("form-navio").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById("saida-msg");
  msgEl.textContent = "Salvando...";

  const { error } = await sb.from("navios").insert({
    nome: document.getElementById("nv-nome").value,
    cliente_id: document.getElementById("nv-cliente").value,
    produto: document.getElementById("nv-produto").value,
    eta_itacoatiara: document.getElementById("nv-eta").value || null,
    etb_novo_remanso: document.getElementById("nv-etb").value || null,
    estada_dias: document.getElementById("nv-estada").value ? Number(document.getElementById("nv-estada").value) : null,
    volume_previsto: Number(document.getElementById("nv-volume").value),
  });

  if (error) { msgEl.textContent = "Erro ao programar navio: " + error.message; return; }

  msgEl.textContent = "Navio programado com sucesso.";
  document.getElementById("form-navio").reset();
  carregarSaidas();
});

document.getElementById("form-saida").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById("saida-msg");
  msgEl.textContent = "Salvando...";

  const { error } = await sb.from("saidas_navio").insert({
    navio_id: document.getElementById("sd-navio").value,
    cliente_id: document.getElementById("sd-cliente").value,
    data: document.getElementById("sd-data").value,
    volume: Number(document.getElementById("sd-volume").value),
    previsao: document.getElementById("sd-previsao").checked,
  });

  if (error) { msgEl.textContent = "Erro ao registrar saída: " + error.message; return; }

  msgEl.textContent = "Saída registrada com sucesso.";
  document.getElementById("sd-volume").value = "";
  carregarSaidas();
});

async function carregarSaidas() {
  if (!document.getElementById("sd-data").value) {
    document.getElementById("sd-data").value = new Date().toISOString().slice(0, 10);
  }
  const { data } = await sb
    .from("navios")
    .select("id, nome, status, volume_previsto, eta_itacoatiara, etb_novo_remanso, estada_dias, produto, cliente_id, clientes(nome)")
    .order("eta_itacoatiara", { ascending: true });

  CACHE_NAVIOS = data ?? [];

  document.getElementById("tbody-navios").innerHTML = (data ?? []).map((n) => `
    <tr>
      <td>${n.nome}</td>
      <td>${n.clientes?.nome ?? "-"}</td>
      <td>${fmtData(n.eta_itacoatiara)}</td>
      <td>${fmtData(n.etb_novo_remanso)}</td>
      <td>${Number(n.volume_previsto).toLocaleString("pt-BR")} t</td>
      <td style="text-align:center">${n.estada_dias ?? "-"}</td>
      <td style="text-transform:capitalize">${n.status}</td>
      <td><button class="btn-editar" onclick="editarNavioPorId('${n.id}')">Editar</button></td>
    </tr>
  `).join("");

  const selNavio = document.getElementById("sd-navio");
  selNavio.innerHTML = '<option value="">Selecione o navio</option>' +
    (data ?? []).map((n) => `<option value="${n.id}">${n.nome} — ${n.clientes?.nome ?? ""}</option>`).join("");

  // Item 3: lista apenas saídas PREVISTAS (não realizadas — realizadas vêm do Logone)
  const { data: saidas } = await sb
    .from("saidas_navio")
    .select("id, data, volume, previsao, produto, cliente_id, clientes(nome), navios(nome, id)")
    .neq("previsao", false)
    .order("data", { ascending: true });

  CACHE_SAIDAS = saidas ?? [];

  const tbodySaidas = document.getElementById("tbody-saidas-lista");
  if (!saidas?.length) {
    tbodySaidas.innerHTML = `<tr><td colspan="8" style="color:var(--texto-fraco);padding:16px;text-align:center">Nenhuma saída prevista cadastrada. Carregamentos realizados vêm do Logone automaticamente.</td></tr>`;
    return;
  }

  tbodySaidas.innerHTML = (saidas ?? []).map((s) => `
    <tr>
      <td>${fmtData(s.data)}</td>
      <td>${s.clientes?.nome ?? "-"}</td>
      <td>${s.navios?.nome ?? "-"}</td>
      <td>${Number(s.volume).toLocaleString("pt-BR")}</td>
      <td style="text-transform:capitalize">${s.produto ?? "soja"}</td>
      <td class="status-previsao">Previsão</td>
      <td style="display:flex;gap:4px">
        <button class="btn-editar" onclick="editarSaidaPorId('${s.id}')">Editar</button>
        <button class="btn-editar" style="color:#ff5252;border-color:#ff5252" onclick="excluirSaida('${s.id}')">Excluir</button>
      </td>
    </tr>
  `).join("");
}

let CACHE_NAVIOS = [];
function editarNavioPorId(id) {
  const n = CACHE_NAVIOS.find(r => r.id === id);
  if (!n) return;
  EDICAO_ATUAL = { tabela: "navios", id };
  document.getElementById("modal-titulo").textContent = "Editar navio programado";
  document.getElementById("modal-campos").innerHTML = `
    <div class="campo"><label>Nome do navio</label><input type="text" id="modal-nv-nome" value="${n.nome}" /></div>
    <div class="campo"><label>Cliente</label>
      <select id="modal-nv-cliente">
        <option value="">— sem cliente —</option>
        ${CLIENTES.map(c => `<option value="${c.id}" ${c.id === n.cliente_id ? "selected" : ""}>${c.nome}</option>`).join("")}
      </select>
    </div>
    <div class="campo"><label>Produto</label>
      <select id="modal-nv-produto">
        <option value="soja" ${n.produto === "soja" ? "selected" : ""}>Soja</option>
        <option value="milho" ${n.produto === "milho" ? "selected" : ""}>Milho</option>
      </select>
    </div>
    <div class="campo"><label>ETA Itacoatiara</label><input type="date" id="modal-nv-eta" value="${n.eta_itacoatiara ?? ""}" /></div>
    <div class="campo"><label>ETB Novo Remanso</label><input type="date" id="modal-nv-etb" value="${n.etb_novo_remanso ?? ""}" /></div>
    <div class="campo"><label>Estada prevista (dias)</label><input type="number" id="modal-nv-estada" value="${n.estada_dias ?? ""}" min="0" /></div>
    <div class="campo"><label>Volume previsto (toneladas)</label><input type="number" step="0.001" id="modal-nv-volume" value="${n.volume_previsto}" /></div>
    <div class="campo"><label>Status</label>
      <select id="modal-nv-status">
        <option value="previsto" ${n.status === "previsto" ? "selected" : ""}>Previsto</option>
        <option value="atracado" ${n.status === "atracado" ? "selected" : ""}>Atracado</option>
        <option value="carregando" ${n.status === "carregando" ? "selected" : ""}>Carregando</option>
        <option value="concluido" ${n.status === "concluido" ? "selected" : ""}>Concluído</option>
      </select>
    </div>
  `;
  document.getElementById("modal-msg").textContent = "";
  document.getElementById("modal-overlay").classList.remove("oculto");

  document.getElementById("modal-salvar").onclick = async () => {
    const msgEl = document.getElementById("modal-msg");
    msgEl.textContent = "Salvando...";
    const clienteId = document.getElementById("modal-nv-cliente").value;
    const { error } = await sb.from("navios").update({
      nome: document.getElementById("modal-nv-nome").value,
      cliente_id: clienteId || null,
      produto: document.getElementById("modal-nv-produto").value,
      eta_itacoatiara: document.getElementById("modal-nv-eta").value || null,
      etb_novo_remanso: document.getElementById("modal-nv-etb").value || null,
      estada_dias: document.getElementById("modal-nv-estada").value ? Number(document.getElementById("modal-nv-estada").value) : null,
      volume_previsto: Number(document.getElementById("modal-nv-volume").value),
      status: document.getElementById("modal-nv-status").value,
    }).eq("id", id);
    if (error) { msgEl.textContent = "Erro: " + error.message; return; }
    fecharModal();
    carregarSaidas();
    carregarDashboard();
  };
}

let CACHE_SAIDAS = [];
function editarSaidaPorId(id) {
  const registro = CACHE_SAIDAS.find((r) => r.id === id);
  if (registro) abrirModalEdicaoSaida(registro);
}

async function excluirSaida(id) {
  if (!confirm("Excluir esta saída prevista?")) return;
  const { error } = await sb.from("saidas_navio").delete().eq("id", id);
  if (error) { alert("Erro ao excluir: " + error.message); return; }
  carregarSaidas();
  carregarDashboard();
}

// ============================================================
// COTAS DE ARMAZÉM — capacidade alocada por cliente
// ============================================================
async function carregarCapacidade() {
  const { data: cfg } = await sb.from("configuracoes").select("capacidade_total_ton").eq("id", 1).single();
  const CAPACIDADE = cfg?.capacidade_total_ton ?? 85000;

  // Tenta carregar da view; se não existir, monta manualmente
  let utilizacao = null;
  const { data: viewData, error: viewErr } = await sb.from("vw_utilizacao_cliente").select("*").order("cliente_nome");
  if (!viewErr) {
    utilizacao = viewData;
  } else {
    // Fallback: carrega clientes + estoque atual manualmente
    const { data: clientes } = await sb.from("clientes").select("id, nome").eq("ativo", true).order("nome");
    const { data: estoque } = await sb.from("vw_estoque_atual_cliente").select("*");
    const { data: cotas } = await sb.from("capacidade_cliente").select("cliente_id, capacidade_ton");

    utilizacao = (clientes ?? []).map(c => {
      const est = (estoque ?? []).find(e => e.cliente_id === c.id);
      const cota = (cotas ?? []).find(k => k.cliente_id === c.id);
      const cap = Number(cota?.capacidade_ton ?? 0);
      const saldo = Number(est?.saldo_atual ?? 0);
      return {
        cliente_id: c.id,
        cliente_nome: c.nome,
        capacidade_alocada: cap,
        saldo_atual: saldo,
        saldo_livre: cap - saldo,
        percentual_utilizado: cap > 0 ? Math.round(saldo / cap * 100) : 0,
      };
    });
  }

  const somaAlocada = (utilizacao ?? []).reduce((a, c) => a + Number(c.capacidade_alocada), 0);
  const saldoDisponivel = CAPACIDADE - somaAlocada;

  document.getElementById("cap-total").textContent = formatarTon(CAPACIDADE);
  document.getElementById("cap-alocada").textContent = formatarTon(somaAlocada);
  document.getElementById("cap-disponivel").textContent = formatarTon(saldoDisponivel);
  document.getElementById("cap-bar-fill").style.width = `${Math.min(100, (somaAlocada / CAPACIDADE) * 100).toFixed(1)}%`;
  document.getElementById("cap-bar-fill").style.background = somaAlocada > CAPACIDADE ? "#ff5252" : "var(--verde-2)";

  const tbody = document.getElementById("tbody-capacidade");
  tbody.innerHTML = (utilizacao ?? [])
    .filter(c => !c.cliente_nome?.includes("@") && !c.cliente_nome?.includes(".com"))
    .map(c => {
      const pct = Math.min(100, Math.round(Number(c.saldo_atual) / Math.max(1, Number(c.capacidade_alocada)) * 100));
      const cor = pct > 95 ? "#ff5252" : pct > 75 ? "var(--laranja)" : "var(--verde-2)";
      return `<tr>
        <td style="font-weight:600">${c.cliente_nome}</td>
        <td>
          <div class="cap-input-wrap">
            <input type="number" class="cap-input" data-id="${c.cliente_id}"
              value="${Number(c.capacidade_alocada).toFixed(0)}" step="100" min="0" max="${CAPACIDADE}" />
            <span class="cap-input-unit">t</span>
          </div>
        </td>
        <td>${formatarTon(c.saldo_atual)}</td>
        <td>${formatarTon(c.saldo_livre)}</td>
        <td>
          <div class="cap-uso-wrap">
            <div class="cap-uso-bar"><div class="cap-uso-fill" style="width:${pct}%;background:${cor}"></div></div>
            <span style="color:${cor};font-weight:600">${pct}%</span>
          </div>
        </td>
      </tr>`;
    }).join("");

  document.getElementById("cap-msg").textContent = "";
}

document.getElementById("btn-salvar-cotas").addEventListener("click", async () => {
  const msgEl = document.getElementById("cap-msg");
  msgEl.textContent = "Salvando...";
  msgEl.style.color = "var(--texto-fraco)";

  const inputs = document.querySelectorAll(".cap-input");
  const { data: cfg } = await sb.from("configuracoes").select("capacidade_total_ton").eq("id", 1).single();
  const CAPACIDADE = cfg?.capacidade_total_ton ?? 85000;

  let soma = 0;
  const updates = Array.from(inputs).map(input => {
    const val = Number(input.value) || 0;
    soma += val;
    return { cliente_id: input.dataset.id, capacidade_ton: val };
  });

  if (soma > CAPACIDADE) {
    msgEl.textContent = `A soma das cotas (${formatarTon(soma)}) ultrapassa a capacidade do armazém (${formatarTon(CAPACIDADE)}). Reduza os valores antes de salvar.`;
    msgEl.style.color = "#ff5252";
    return;
  }

  const { data: { user } } = await sb.auth.getUser();

  let erros = 0;
  for (const u of updates) {
    const { error } = await sb.from("capacidade_cliente").upsert({
      cliente_id: u.cliente_id,
      capacidade_ton: u.capacidade_ton,
      updated_by: user?.id ?? null,
    }, { onConflict: "cliente_id" });
    if (error) { erros++; console.error(error.message); }
  }

  if (erros > 0) {
    msgEl.textContent = `${erros} cota(s) não foram salvas. Verifique se rodou o script capacidade_cliente.sql no Supabase.`;
    msgEl.style.color = "#ff5252";
  } else {
    msgEl.textContent = "Cotas salvas com sucesso.";
    msgEl.style.color = "var(--verde-2)";
    carregarCapacidade();
  }
});

// ============================================================
// CLIENTES E USUÁRIOS (ADMIN)
// ============================================================
document.getElementById("form-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("cli-nome").value.trim();
  if (!nome) return;
  const msgEl = document.getElementById("clientes-msg");
  const { error } = await sb.from("clientes").insert({ nome });
  if (error) { msgEl.textContent = "Erro: " + error.message; return; }
  msgEl.textContent = `Cliente "${nome}" adicionado com sucesso.`;
  document.getElementById("cli-nome").value = "";
  await carregarClientes();
  await carregarClientesUsuarios();
});

async function excluirCliente(id, nome) {
  if (!confirm(`Tem certeza que deseja remover o cliente "${nome}"?\n\nIsso não apaga os lançamentos já feitos para esse cliente.`)) return;
  const { error } = await sb.from("clientes").update({ ativo: false }).eq("id", id);
  const msgEl = document.getElementById("clientes-msg");
  if (error) { msgEl.textContent = "Erro ao remover: " + error.message; return; }
  msgEl.textContent = `Cliente "${nome}" removido.`;
  await carregarClientes();
  await carregarClientesUsuarios();
}

// Criar novo usuário
document.getElementById("form-novo-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("novo-usuario-email").value.trim();
  const senha = document.getElementById("novo-usuario-senha").value;
  const msgEl = document.getElementById("clientes-msg");
  msgEl.textContent = "Criando usuário...";

  const { error } = await sb.auth.signUp({
    email,
    password: senha,
    options: { emailRedirectTo: window.location.origin }
  });

  if (error) {
    msgEl.textContent = "Erro ao criar usuário: " + error.message;
    return;
  }

  msgEl.textContent = `✅ Usuário ${email} criado. Após o primeiro login, defina o perfil e cliente dele na tabela abaixo.`;
  document.getElementById("novo-usuario-email").value = "";
  document.getElementById("novo-usuario-senha").value = "";
  setTimeout(() => carregarClientesUsuarios(), 1500);
});

async function carregarClientesUsuarios() {
  // Lista de clientes com botão de excluir
  document.getElementById("lista-clientes").innerHTML =
    CLIENTES.map((c) => `
      <li style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span>${c.nome}</span>
        <button onclick="excluirCliente('${c.id}', '${c.nome}')"
          style="background:none;border:1px solid #2a2f3d;color:var(--texto-fraco);border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer"
          onmouseover="this.style.color='#ff5252';this.style.borderColor='#ff5252'"
          onmouseout="this.style.color='var(--texto-fraco)';this.style.borderColor='#2a2f3d'">
          Remover
        </button>
      </li>`).join("");

  const { data: usuarios } = await sb
    .from("profiles")
    .select("id, nome, role, cliente_id, clientes(nome)")
    .order("nome");

  document.getElementById("tbody-usuarios").innerHTML = (usuarios ?? []).map((u) => `
    <tr>
      <td>${u.nome}</td>
      <td>
        <select id="role-sel-${u.id}" onchange="atualizarUsuario('${u.id}', this.value, document.getElementById('cli-sel-${u.id}').value)">
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          <option value="operacao" ${u.role === "operacao" ? "selected" : ""}>operação</option>
          <option value="cliente" ${u.role === "cliente" ? "selected" : ""}>cliente</option>
        </select>
      </td>
      <td>
        <select id="cli-sel-${u.id}" onchange="atualizarUsuario('${u.id}', document.getElementById('role-sel-${u.id}').value, this.value)">
          <option value="">—</option>
          ${CLIENTES.map((c) => `<option value="${c.id}" ${u.cliente_id === c.id ? "selected" : ""}>${c.nome}</option>`).join("")}
        </select>
      </td>
    </tr>
  `).join("");
}

async function atualizarUsuario(id, role, clienteId) {
  const { error } = await sb.from("profiles").update({
    role,
    cliente_id: role === "cliente" ? (clienteId || null) : null,
  }).eq("id", id);

  const msgEl = document.getElementById("clientes-msg");
  msgEl.textContent = error ? "Erro ao atualizar usuário: " + error.message : "Usuário atualizado.";
  carregarClientesUsuarios();
}

// ============================================================
// LINHA DO TEMPO — chegadas de comboios e saídas de navios
// ============================================================
// ============================================================
// POOL DASHBOARD — visão executiva
// ============================================================
let GRAFICO_DONUT = null;
let GRAFICO_GANTT = null;

async function carregarPoolDashboard() {
  const container = document.getElementById("view-pool");
  if (!container) return;

  const hoje = new Date();
  document.getElementById("pool-data-hoje").textContent =
    hoje.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

  const { data: estoque } = await sb.from("vw_estoque_atual_cliente").select("*");
  const { data: navios } = await sb.from("navios")
    .select("id, nome, status, volume_previsto, eta_itacoatiara, etb_novo_remanso, clientes(nome)")
    .in("status", ["previsto", "atracado", "carregando"])
    .order("etb_novo_remanso", { ascending: true });

  const { data: comboiosFuturos } = await sb.from("comboios")
    .select("id, nome, produto, data_saida_pvh, eta")
    .order("eta", { ascending: true })
    .limit(8);

  const { data: saidas } = await sb.from("saidas_navio")
    .select("navio_id, volume, previsao");

  const CAPACIDADE = CAPACIDADE_TOTAL;
  const estoqueTotal = (estoque ?? []).reduce((a, c) => a + Number(c.saldo_atual), 0);
  const saldoLivre = CAPACIDADE - estoqueTotal;
  const ocupacao = CAPACIDADE ? Math.round(estoqueTotal / CAPACIDADE * 1000) / 10 : 0;
  const volumeComprometido = (navios ?? []).reduce((a, n) => a + Number(n.volume_previsto), 0);
  const naviosAtivos = (navios ?? []).length;
  const comboiosAtivos = (comboiosFuturos ?? []).length;

  document.getElementById("pool-estoque").textContent = formatarTon(estoqueTotal);
  document.getElementById("pool-livre").textContent = formatarTon(saldoLivre);
  document.getElementById("pool-ocupacao").textContent = `${ocupacao}%`;
  document.getElementById("pool-comboios").textContent = comboiosAtivos;
  document.getElementById("pool-navios").textContent = naviosAtivos;
  document.getElementById("pool-comprometido").textContent = formatarTon(volumeComprometido);
  document.getElementById("pool-bar-fill").style.width = `${Math.min(ocupacao, 100)}%`;
  document.getElementById("pool-bar-livre").style.width = `${Math.min(100 - ocupacao, 100)}%`;

  // tabela de clientes
  const tbody = document.getElementById("pool-tbody-clientes");
  tbody.innerHTML = (estoque ?? []).map(c => {
    const navioCliente = (navios ?? []).filter(n => n.clientes?.nome === c.cliente_nome);
    const comprometido = navioCliente.reduce((a, n) => a + Number(n.volume_previsto), 0);
    const saldoLivreCliente = Number(c.saldo_atual) - comprometido;
    return `<tr>
      <td style="font-weight:500">${c.cliente_nome}</td>
      <td>${Number(c.total_entradas).toLocaleString("pt-BR")}</td>
      <td>${Number(c.total_saidas).toLocaleString("pt-BR")}</td>
      <td style="color:var(--verde-2);font-weight:600">${Number(c.saldo_atual).toLocaleString("pt-BR")}</td>
      <td>${comprometido.toLocaleString("pt-BR")}</td>
      <td style="color:${saldoLivreCliente < 0 ? "var(--laranja)" : "var(--verde-2)"}">${saldoLivreCliente.toLocaleString("pt-BR")}</td>
    </tr>`;
  }).join("");

  // donut
  const CORES = ["#4F904C", "#AFD248", "#EE8133", "#5B9A58"];
  const saldos = (estoque ?? []).map((c, i) => ({ nome: c.cliente_nome, val: Number(c.saldo_atual), cor: CORES[i % CORES.length] }));
  if (GRAFICO_DONUT) GRAFICO_DONUT.destroy();
  const donutCtx = document.getElementById("pool-donut");
  if (donutCtx && saldos.length) {
    GRAFICO_DONUT = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels: saldos.map(s => s.nome),
        datasets: [{ data: saldos.map(s => s.val), backgroundColor: saldos.map(s => s.cor), borderWidth: 2, borderColor: "#151821" }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `${i.label}: ${i.raw.toLocaleString("pt-BR")} t` } } }
      }
    });
  }

  const donutLeg = document.getElementById("pool-donut-leg");
  donutLeg.innerHTML = saldos.map(s => {
    const pct = estoqueTotal ? Math.round(s.val / estoqueTotal * 100) : 0;
    return `<div class="pool-dleg"><span class="pool-dleg-dot" style="background:${s.cor}"></span><span>${s.nome}</span><span class="pool-dleg-val">${s.val.toLocaleString("pt-BR")} t · ${pct}%</span></div>`;
  }).join("");

  // Gantt
  renderGantt(comboiosFuturos ?? [], navios ?? []);
}

function renderGantt(comboios, navios) {
  const hoje = new Date();
  const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 3);
  const fim = new Date(hoje); fim.setDate(hoje.getDate() + 57);
  const span = (fim - inicio) / (1000 * 60 * 60 * 24);

  function pct(d) { return Math.max(0, Math.min(100, (new Date(d) - inicio) / (fim - inicio) * 100)); }
  function dur(s, e) { return Math.max(0.5, (new Date(e) - new Date(s)) / (fim - inicio) * 100); }

  const todayPct = pct(hoje);
  const ganttEl = document.getElementById("pool-gantt");
  if (!ganttEl) return;

  const eventos = [
    ...comboios.filter(c => c.eta).map(c => ({
      tipo: "comboio", nome: c.nome, inicio: c.data_saida_pvh || c.eta,
      fim: c.eta, prev: new Date(c.eta) > hoje
    })),
    ...navios.filter(n => n.etb_novo_remanso).map(n => ({
      tipo: "navio", nome: n.nome, sub: `${n.clientes?.nome ?? ""} · ${Number(n.volume_previsto).toLocaleString("pt-BR")} t`,
      inicio: n.etb_novo_remanso,
      fim: (() => { const d = new Date(n.etb_novo_remanso); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })(),
      prev: new Date(n.etb_novo_remanso) > hoje
    }))
  ].sort((a, b) => a.inicio > b.inicio ? 1 : -1);

  ganttEl.innerHTML = eventos.map(ev => {
    const s = pct(ev.inicio); const w = dur(ev.inicio, ev.fim);
    const cls = `pool-gbar pool-gbar-${ev.tipo}${ev.prev ? " pool-gbar-prev" : ""}`;
    return `<div class="pool-grow">
      <div class="pool-gname" title="${ev.nome}">${ev.nome}</div>
      <div class="pool-gtrack">
        <div class="${cls}" style="left:${s.toFixed(1)}%;width:${w.toFixed(1)}%">${ev.nome.split(" ").slice(0,3).join(" ")}</div>
        <div class="pool-gtoday" style="left:${todayPct.toFixed(1)}%"></div>
      </div>
    </div>`;
  }).join("") + `<div style="display:flex;padding-left:168px;font-size:10px;color:var(--texto-fraco);margin-top:4px;position:relative;height:16px">
    ${[0,15,30,45,60].map(d => { const dt = new Date(inicio); dt.setDate(inicio.getDate()+d); return `<div style="position:absolute;left:${(d/span*100).toFixed(1)}%;transform:translateX(-50%)">${dt.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</div>`; }).join("")}
  </div>`;
}

// ============================================================
// LINHA DO TEMPO — horizontal (Gantt visual melhorado)
// ============================================================
document.getElementById("tl-filtrar").addEventListener("click", carregarTimeline);

async function carregarTimeline() {
  const hoje = new Date();
  if (!document.getElementById("tl-data-inicio").value) {
    const d = new Date(); d.setDate(d.getDate() - 30);
    document.getElementById("tl-data-inicio").value = d.toISOString().slice(0, 10);
  }
  if (!document.getElementById("tl-data-fim").value) {
    const d = new Date(); d.setDate(d.getDate() + 30);
    document.getElementById("tl-data-fim").value = d.toISOString().slice(0, 10);
  }

  const dataInicio = document.getElementById("tl-data-inicio").value;
  const dataFim = document.getElementById("tl-data-fim").value;
  const tipo = document.getElementById("tl-tipo").value;
  const clienteFiltro = PERFIL.role === "cliente" ? PERFIL.cliente_id : document.getElementById("tl-cliente").value;

  const eventos = [];

  if (tipo === "todos" || tipo === "entrada") {
    let q = sb.from("descargas_barcacas")
      .select("data, hora, qtd_bg, numero_bg, previsao, clientes(nome), comboios(nome, produto)")
      .gte("data", dataInicio).lte("data", dataFim);
    if (clienteFiltro) q = q.eq("cliente_id", clienteFiltro);
    const { data } = await q;
    (data ?? []).forEach(d => eventos.push({
      tipo: "entrada", data: d.data,
      titulo: d.comboios?.nome || "Comboio",
      sub: `${d.clientes?.nome ?? "-"} · ${d.comboios?.produto ?? "soja"}`,
      volume: Number(d.qtd_bg), previsao: d.previsao
    }));
  }

  if (tipo === "todos" || tipo === "saida") {
    let q = sb.from("saidas_navio")
      .select("data, volume, previsao, clientes(nome), navios(nome, produto)")
      .gte("data", dataInicio).lte("data", dataFim);
    if (clienteFiltro) q = q.eq("cliente_id", clienteFiltro);
    const { data } = await q;
    (data ?? []).forEach(s => eventos.push({
      tipo: "saida", data: s.data,
      titulo: s.navios?.nome || "Navio",
      sub: `${s.clientes?.nome ?? "-"} · ${s.navios?.produto ?? "soja"}`,
      volume: Number(s.volume), previsao: s.previsao
    }));
  }

  eventos.sort((a, b) => a.data < b.data ? -1 : 1);

  const entradas = eventos.filter(e => e.tipo === "entrada");
  const saidas = eventos.filter(e => e.tipo === "saida");
  const totalE = entradas.reduce((a, e) => a + e.volume, 0);
  const totalS = saidas.reduce((a, e) => a + e.volume, 0);

  document.getElementById("tl-resumo").innerHTML = `
    <div class="tl-kpi"><span class="tl-kpi-n">${entradas.length}</span><span class="tl-kpi-l">chegadas · ${formatarTon(totalE)}</span></div>
    <div class="tl-kpi"><span class="tl-kpi-n" style="color:var(--laranja)">${saidas.length}</span><span class="tl-kpi-l">saídas · ${formatarTon(totalS)}</span></div>
    <div class="tl-kpi"><span class="tl-kpi-n">${formatarTon(totalE - totalS)}</span><span class="tl-kpi-l">saldo líquido</span></div>
  `;

  const lista = document.getElementById("tl-lista");
  if (!eventos.length) { lista.innerHTML = `<p class="texto-ajuda" style="padding:1rem 0">Nenhum evento nesse período.</p>`; return; }

  function renderSecao(evs, tipo) {
    if (!evs.length) return "";
    const porMes = {};
    evs.forEach(e => {
      const mes = e.data.slice(0, 7);
      if (!porMes[mes]) porMes[mes] = [];
      porMes[mes].push(e);
    });

    const conteudo = Object.entries(porMes).map(([mes, items]) => {
      const [ano, m] = mes.split("-");
      const nomeMes = new Date(ano, m-1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      const cards = items.map(e => `
        <div class="tl-card tl-card-${e.tipo}">
          <div class="tl-card-top">
            <span class="tl-card-data">${fmtData(e.data)}</span>
            ${e.previsao ? '<span class="tl-tag-prev">prev.</span>' : ""}
          </div>
          <div class="tl-card-nome">${e.titulo}</div>
          <div class="tl-card-sub">${e.sub}</div>
          <div class="tl-card-vol">${formatarTon(e.volume)}</div>
        </div>`).join("");
      return `<div class="tl-mes-grupo">
        <div class="tl-mes-label">${nomeMes}</div>
        <div class="tl-cards-row">${cards}</div>
      </div>`;
    }).join("");

    const titulo = tipo === "entrada"
      ? `📥 Chegadas de Comboios (${evs.length} · ${formatarTon(evs.reduce((a,e)=>a+e.volume,0))})`
      : `📤 Saídas de Navios (${evs.length} · ${formatarTon(evs.reduce((a,e)=>a+e.volume,0))})`;

    return `<div class="tl-secao tl-secao-${tipo}">
      <div class="tl-secao-titulo">${titulo}</div>
      ${conteudo}
    </div>`;
  }

  const mostrarEntradas = tipo === "todos" || tipo === "entrada";
  const mostrarSaidas = tipo === "todos" || tipo === "saida";

  lista.innerHTML =
    (mostrarEntradas ? renderSecao(entradas, "entrada") : "") +
    (mostrarSaidas ? renderSecao(saidas, "saida") : "");
}

// ============================================================
// MODAL DE EDIÇÃO (genérico para entradas e saídas)
// ============================================================
let EDICAO_ATUAL = null;

document.getElementById("modal-cancelar").addEventListener("click", fecharModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") fecharModal();
});

function fecharModal() {
  document.getElementById("modal-overlay").classList.add("oculto");
  EDICAO_ATUAL = null;
}

function abrirModalEdicaoEntrada(registro) {
  EDICAO_ATUAL = { tabela: "descargas_barcacas", id: registro.id };
  document.getElementById("modal-titulo").textContent = "Editar entrada prevista (descarga de barcaça)";
  document.getElementById("modal-campos").innerHTML = `
    <div class="campo"><label>Data</label><input type="date" id="modal-data" value="${registro.data}" /></div>
    <div class="campo"><label>Cliente</label>
      <select id="modal-cliente-id">
        ${CLIENTES.map(c => `<option value="${c.id}" ${c.id === registro.cliente_id ? "selected" : ""}>${c.nome}</option>`).join("")}
      </select>
    </div>
    <div class="campo"><label>Turno</label>
      <select id="modal-turno">
        <option value="1" ${registro.hora == 1 ? "selected" : ""}>1º turno</option>
        <option value="2" ${registro.hora == 2 ? "selected" : ""}>2º turno</option>
        <option value="3" ${registro.hora == 3 ? "selected" : ""}>3º turno</option>
      </select>
    </div>
    <div class="campo"><label>Produto</label>
      <select id="modal-produto">
        <option value="soja" ${(registro.produto ?? "soja") === "soja" ? "selected" : ""}>Soja</option>
        <option value="milho" ${registro.produto === "milho" ? "selected" : ""}>Milho</option>
      </select>
    </div>
    <div class="campo"><label>Comboio / Barcaça</label><input type="text" id="modal-numero-bg" value="${registro.numero_bg ?? registro.comboios?.nome ?? ""}" /></div>
    <div class="campo"><label>Quantidade (toneladas)</label><input type="number" step="0.01" id="modal-qtd" value="${registro.qtd_bg}" /></div>
    <div class="campo checkbox-campo">
      <input type="checkbox" id="modal-previsao" ${registro.previsao ? "checked" : ""} />
      <label for="modal-previsao">Ainda é previsão</label>
    </div>
  `;
  document.getElementById("modal-msg").textContent = "";
  document.getElementById("modal-overlay").classList.remove("oculto");

  document.getElementById("modal-salvar").onclick = async () => {
    const msgEl = document.getElementById("modal-msg");
    msgEl.textContent = "Salvando...";
    const { error } = await sb.from("descargas_barcacas").update({
      data: document.getElementById("modal-data").value,
      cliente_id: document.getElementById("modal-cliente-id").value,
      hora: Number(document.getElementById("modal-turno").value),
      produto: document.getElementById("modal-produto").value,
      numero_bg: document.getElementById("modal-numero-bg").value || null,
      qtd_bg: Number(document.getElementById("modal-qtd").value),
      previsao: document.getElementById("modal-previsao").checked,
    }).eq("id", registro.id);

    if (error) { msgEl.textContent = "Erro: " + error.message; return; }
    fecharModal();
    carregarEntradas();
    if (!document.getElementById("view-dashboard").classList.contains("oculto")) carregarDashboard();
  };
}

function abrirModalEdicaoSaida(registro) {
  EDICAO_ATUAL = { tabela: "saidas_navio", id: registro.id };
  document.getElementById("modal-titulo").textContent = "Editar saída prevista (carregamento)";
  document.getElementById("modal-campos").innerHTML = `
    <div class="campo"><label>Data</label><input type="date" id="modal-data" value="${registro.data}" /></div>
    <div class="campo"><label>Cliente</label>
      <select id="modal-cliente-id">
        ${CLIENTES.map(c => `<option value="${c.id}" ${c.id === registro.cliente_id ? "selected" : ""}>${c.nome}</option>`).join("")}
      </select>
    </div>
    <div class="campo"><label>Produto</label>
      <select id="modal-produto">
        <option value="soja" ${(registro.produto ?? "soja") === "soja" ? "selected" : ""}>Soja</option>
        <option value="milho" ${registro.produto === "milho" ? "selected" : ""}>Milho</option>
      </select>
    </div>
    <div class="campo"><label>Volume (toneladas)</label><input type="number" step="0.01" id="modal-volume" value="${registro.volume}" /></div>
    <div class="campo checkbox-campo">
      <input type="checkbox" id="modal-previsao" ${registro.previsao ? "checked" : ""} />
      <label for="modal-previsao">Ainda é previsão</label>
    </div>
  `;
  document.getElementById("modal-msg").textContent = "";
  document.getElementById("modal-overlay").classList.remove("oculto");

  document.getElementById("modal-salvar").onclick = async () => {
    const msgEl = document.getElementById("modal-msg");
    msgEl.textContent = "Salvando...";
    const { error } = await sb.from("saidas_navio").update({
      data: document.getElementById("modal-data").value,
      cliente_id: document.getElementById("modal-cliente-id").value,
      produto: document.getElementById("modal-produto").value,
      volume: Number(document.getElementById("modal-volume").value),
      previsao: document.getElementById("modal-previsao").checked,
    }).eq("id", registro.id);

    if (error) { msgEl.textContent = "Erro: " + error.message; return; }
    fecharModal();
    carregarSaidas();
    if (!document.getElementById("view-dashboard").classList.contains("oculto")) carregarDashboard();
  };
}

// ============================================================
// LINE-UP — navios e barcaças
// ============================================================
async function carregarLineup() {
  const agora = new Date();
  document.getElementById("lineup-update").textContent =
    agora.toLocaleDateString("pt-BR") + " " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // Navios ativos (não concluídos)
  const { data: navios } = await sb
    .from("navios")
    .select("id, nome, numero_carga, quinzena, status, eta_itacoatiara, etb_novo_remanso, ets, ets_fazendinha, nor, queue_day, volume_previsto, produto, agentes, destino, clientes(nome)")
    .neq("status", "concluido")
    .order("etb_novo_remanso", { ascending: true });

  // Comboios ativos (barcaças)
  const { data: comboios } = await sb
    .from("comboios")
    .select("id, nome, status_op, data_saida_pvh, eta, ets, etb, qtd_bgs, volume_ton, cliente_nome, produto")
    .neq("status_op", "concluido")
    .order("eta", { ascending: true });

  // Fallback se status_op não existir ainda (antes de rodar o SQL)
  const { data: comboiosFallback } = !comboios?.length
    ? await sb.from("comboios").select("id, nome, data_saida_pvh, eta, ets, produto").order("eta", { ascending: true }).limit(20)
    : { data: null };

  const listaComboios = comboios?.length ? comboios : (comboiosFallback ?? []).map(c => ({
    ...c, status_op: "previsto", qtd_bgs: 0, volume_ton: 0, cliente_nome: "-"
  }));

  // Backlog = comboios em trânsito ou fundeados
  const backlog = listaComboios.filter(c => ["em_transito", "fundeio"].includes(c.status_op)).length;
  document.getElementById("lineup-backlog").textContent = backlog || listaComboios.length;

  // Tabela navios
  const STATUS_NAVIO = {
    previsto:    { label: "EXPECTED",           cor: "#1a4c8a", txt: "#7ab3f5" },
    atracado:    { label: "BERTHED AND LOADING", cor: "#1a5c2a", txt: "#4fcc6a" },
    carregando:  { label: "LOADING",             cor: "#1a5c2a", txt: "#AFD248" },
  };

  document.getElementById("lineup-tbody-navios").innerHTML = (navios ?? []).map(n => {
    const st = STATUS_NAVIO[n.status] ?? { label: n.status, cor: "#2a2f3d", txt: "#9aa39b" };
    return `<tr>
      <td><span class="lu-status" style="background:${st.cor};color:${st.txt}">${st.label}</span></td>
      <td>${n.quinzena ?? "-"}</td>
      <td>${n.numero_carga ?? "-"}</td>
      <td style="font-weight:600;color:var(--texto)">${n.nome}</td>
      <td>${n.ets_fazendinha ? fmtDataHora(n.ets_fazendinha) : "-"}</td>
      <td>${n.nor ? fmtDataHora(n.nor) : "-"}</td>
      <td style="text-align:center">${n.queue_day ?? "-"}</td>
      <td>${n.eta_itacoatiara ? fmtData(n.eta_itacoatiara) : "-"}</td>
      <td>${n.etb_novo_remanso ? fmtData(n.etb_novo_remanso) : "-"}</td>
      <td>${n.ets ? fmtData(n.ets) : "-"}</td>
      <td style="font-weight:600">${n.clientes?.nome ?? "-"}</td>
      <td style="text-align:right">${n.volume_previsto ? Number(n.volume_previsto).toLocaleString("pt-BR", {maximumFractionDigits:0}) : "-"}</td>
      <td style="text-transform:capitalize">${n.produto ?? "-"}</td>
      <td>${n.agentes ?? "-"}</td>
      <td>${n.destino ?? "-"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="15" style="text-align:center;color:var(--texto-fraco);padding:14px">Nenhum navio ativo no momento.</td></tr>`;

  // Tabela comboios / barcaças
  const STATUS_BG = {
    em_transito: { label: "EM TRÂNSITO", cor: "#7a3000", txt: "#ff9147" },
    fundeio:     { label: "FUNDEIO",     cor: "#005555", txt: "#00d4d4" },
    previsto:    { label: "PREVISTO",    cor: "#1a3566", txt: "#6699ff" },
    concluido:   { label: "CONCLUÍDO",   cor: "#333",    txt: "#888" },
  };

  document.getElementById("lineup-tbody-barcacas").innerHTML = listaComboios.map(c => {
    const st = STATUS_BG[c.status_op] ?? STATUS_BG.previsto;
    return `<tr>
      <td><span class="lu-status" style="background:${st.cor};color:${st.txt}">${st.label}</span></td>
      <td>${c.data_saida_pvh ? fmtDataHora2(c.data_saida_pvh) : "-"}</td>
      <td>${c.etb ? fmtDataHora2(c.etb) : (c.eta ? fmtDataHora2(c.eta) : "-")}</td>
      <td>${c.ets ? fmtDataHora2(c.ets) : "-"}</td>
      <td style="font-weight:600;color:var(--lima)">${c.nome}</td>
      <td>${c.cliente_nome ?? "-"}</td>
      <td style="text-transform:uppercase">${c.produto ?? "-"}</td>
      <td style="text-align:right">${c.volume_ton ? Number(c.volume_ton).toLocaleString("pt-BR") : "-"}</td>
      <td style="text-align:center">${c.qtd_bgs ?? "-"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--texto-fraco);padding:14px">Nenhuma barcaça ativa.</td></tr>`;
}

function fmtDataHora(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDataHora2(val) {
  if (!val) return "-";
  if (val.includes("T") || val.includes(" ")) return fmtDataHora(val);
  return fmtData(val) + " 06:00";
}
