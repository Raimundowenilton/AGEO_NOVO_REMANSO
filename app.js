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
async function carregarDashboard() {
  const { data: estoqueClientes } = await sb.from("vw_estoque_atual_cliente").select("*");
  const { data: naviosAtivos } = await sb.from("navios")
    .select("volume_previsto, cliente_id")
    .in("status", ["previsto", "atracado", "carregando"]);

  const estoqueTotal = (estoqueClientes ?? []).reduce((acc, c) => acc + Number(c.saldo_atual), 0);
  const volumeRetido = (naviosAtivos ?? []).reduce((acc, n) => acc + Number(n.volume_previsto), 0);
  const saldoLivre = estoqueTotal - volumeRetido;
  const ocupacao = CAPACIDADE_TOTAL ? Math.round((estoqueTotal / CAPACIDADE_TOTAL) * 1000) / 10 : 0;

  document.getElementById("kpi-estoque").textContent = formatarTon(estoqueTotal);
  document.getElementById("kpi-capacidade").textContent = formatarTon(CAPACIDADE_TOTAL);
  const kpiOcupacao = document.getElementById("kpi-ocupacao");
  kpiOcupacao.textContent = `${ocupacao}%`;
  kpiOcupacao.classList.toggle("alerta-vermelho", ocupacao > 95);

  // Card de retenção (novo)
  const kpiRetencao = document.getElementById("kpi-retencao");
  const kpiLivre = document.getElementById("kpi-livre");
  if (kpiRetencao) kpiRetencao.textContent = formatarTon(volumeRetido);
  if (kpiLivre) {
    kpiLivre.textContent = formatarTon(saldoLivre);
    kpiLivre.style.color = saldoLivre < 0 ? "#ff5252" : "var(--lima)";
  }

  // Tabela por cliente com total e retenção por cliente
  const retencaoPorCliente = {};
  (naviosAtivos ?? []).forEach(n => {
    retencaoPorCliente[n.cliente_id] = (retencaoPorCliente[n.cliente_id] ?? 0) + Number(n.volume_previsto);
  });

  const dataSelecionada = document.getElementById("data-consulta")?.value;
  const tbody = document.getElementById("tbody-saldo-cliente");

  // totais acumulados
  let totEntradas = 0, totSaidas = 0, totQuebra = 0, totSaldo = 0, totRetencao = 0;

  tbody.innerHTML = (estoqueClientes ?? []).map((c) => {
    const retencao = retencaoPorCliente[c.cliente_id] ?? 0;
    const livre = Number(c.saldo_atual) - retencao;
    totEntradas += Number(c.total_entradas);
    totSaidas += Number(c.total_saidas);
    totQuebra += Number(c.quebra_total);
    totSaldo += Number(c.saldo_atual);
    totRetencao += retencao;
    return `<tr>
      <td style="font-weight:600">${c.cliente_nome}</td>
      <td>${formatarTon(c.total_entradas)}</td>
      <td>${formatarTon(c.total_saidas)}</td>
      <td>${formatarTon(c.quebra_total)}</td>
      <td style="color:var(--lima);font-weight:600">${formatarTon(c.saldo_atual)}</td>
      <td style="color:var(--laranja)">${formatarTon(retencao)}</td>
      <td style="color:${livre < 0 ? "#ff5252" : "var(--lima)"};font-weight:700">${formatarTon(livre)}</td>
    </tr>`;
  }).join("") + `
    <tr style="border-top:1px solid var(--painel-borda);font-weight:700;background:rgba(255,255,255,0.03)">
      <td>TOTAL</td>
      <td>${formatarTon(totEntradas)}</td>
      <td>${formatarTon(totSaidas)}</td>
      <td>${formatarTon(totQuebra)}</td>
      <td style="color:var(--lima)">${formatarTon(totSaldo)}</td>
      <td style="color:var(--laranja)">${formatarTon(totRetencao)}</td>
      <td style="color:${(totSaldo - totRetencao) < 0 ? "#ff5252" : "var(--lima)"}">${formatarTon(totSaldo - totRetencao)}</td>
    </tr>`;

  // movimentos para projeção — TODOS (para calcular o gráfico completo)
  const { data: entradas } = await sb.from("descargas_barcacas").select("cliente_id, data, previsao, qtd_bg");
  const { data: saidas } = await sb.from("saidas_navio").select("cliente_id, data, previsao, volume");

  const movimentos = [
    ...(entradas ?? []).map((e) => ({ data: e.data, previsao: e.previsao, entrada: Number(e.qtd_bg), saida: 0 })),
    ...(saidas ?? []).map((s) => ({ data: s.data, previsao: s.previsao, entrada: 0, saida: Number(s.volume) })),
  ];

  const { pontos: todosPontos, alertaCapacidade } = projetarEstoque(movimentos, CAPACIDADE_TOTAL);
  PONTOS_ESTOQUE_CACHE = todosPontos;

  // Gráfico mostra só os últimos 30 dias + próximos 30 (padrão)
  const periodoSelecionado = document.getElementById("grafico-periodo")?.value ?? "60";
  filtrarEDesenharGrafico(todosPontos, Number(periodoSelecionado));

  if (!document.getElementById("data-consulta").value) {
    document.getElementById("data-consulta").value = new Date().toISOString().slice(0, 10);
  }
  atualizarEstoqueNaData();

  const alertaEl = document.getElementById("alerta-capacidade");
  if (alertaCapacidade) {
    alertaEl.classList.remove("oculto");
    alertaEl.innerHTML = `⚠ Atenção: pela previsão atual, o estoque ultrapassa a capacidade do armazém em
      <strong>${new Date(alertaCapacidade.data).toLocaleDateString("pt-BR")}</strong>
      (projeção: ${formatarTon(alertaCapacidade.estoqueProjetado)}). Reavalie a programação de navios ou de comboios.`;
  } else {
    alertaEl.classList.add("oculto");
  }
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

  // pega o último ponto conhecido com data <= data selecionada
  // (antes do primeiro ponto = ainda não havia movimento = 0)
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

  // se a data pedida é depois do último movimento conhecido, avisa que é o último valor projetado
  const ultimoPonto = PONTOS_ESTOQUE_CACHE[PONTOS_ESTOQUE_CACHE.length - 1];
  const aviso = document.getElementById("data-consulta-aviso");
  if (ultimoPonto && dataSelecionada > ultimoPonto.data && !achouPosterior) {
    kpiEl.title = `Sem lançamentos previstos após ${new Date(ultimoPonto.data).toLocaleDateString("pt-BR")} — valor mantido.`;
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
  const { data } = await sb
    .from("descargas_barcacas")
    .select("id, data, hora, numero_bg, qtd_bg, previsao, clientes(nome)")
    .order("data", { ascending: false })
    .limit(30);

  CACHE_ENTRADAS = data ?? [];

  document.getElementById("tbody-entradas").innerHTML = (data ?? []).map((l) => `
    <tr>
      <td>${new Date(l.data).toLocaleDateString("pt-BR")}</td>
      <td>${l.hora}</td>
      <td>${l.clientes?.nome ?? "-"}</td>
      <td>${l.numero_bg || "-"}</td>
      <td>${Number(l.qtd_bg).toLocaleString("pt-BR")}</td>
      <td class="${l.previsao ? "status-previsao" : "status-realizado"}">${l.previsao ? "Previsão" : "Realizado"}</td>
      <td><button class="btn-editar" onclick="editarEntradaPorId('${l.id}')">Editar</button></td>
    </tr>
  `).join("");
}

let CACHE_ENTRADAS = [];
function editarEntradaPorId(id) {
  const registro = CACHE_ENTRADAS.find((r) => r.id === id);
  if (registro) abrirModalEdicaoEntrada(registro);
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
    .select("id, nome, status, volume_previsto, eta_itacoatiara, etb_novo_remanso, clientes(nome)")
    .order("eta_itacoatiara", { ascending: true });

  document.getElementById("tbody-navios").innerHTML = (data ?? []).map((n) => `
    <tr>
      <td>${n.nome}</td>
      <td>${n.clientes?.nome ?? "-"}</td>
      <td>${n.eta_itacoatiara ? new Date(n.eta_itacoatiara).toLocaleDateString("pt-BR") : "-"}</td>
      <td>${n.etb_novo_remanso ? new Date(n.etb_novo_remanso).toLocaleDateString("pt-BR") : "-"}</td>
      <td>${Number(n.volume_previsto).toLocaleString("pt-BR")} t</td>
      <td style="text-transform:capitalize">${n.status}</td>
    </tr>
  `).join("");

  const selNavio = document.getElementById("sd-navio");
  selNavio.innerHTML = '<option value="">Selecione o navio</option>' +
    (data ?? []).map((n) => `<option value="${n.id}">${n.nome} — ${n.clientes?.nome ?? ""}</option>`).join("");

  // lista de saídas individuais (editável)
  const { data: saidas } = await sb
    .from("saidas_navio")
    .select("id, data, volume, previsao, clientes(nome), navios(nome)")
    .order("data", { ascending: false })
    .limit(30);

  CACHE_SAIDAS = saidas ?? [];

  document.getElementById("tbody-saidas-lista").innerHTML = (saidas ?? []).map((s) => `
    <tr>
      <td>${new Date(s.data).toLocaleDateString("pt-BR")}</td>
      <td>${s.clientes?.nome ?? "-"}</td>
      <td>${s.navios?.nome ?? "-"}</td>
      <td>${Number(s.volume).toLocaleString("pt-BR")}</td>
      <td class="${s.previsao ? "status-previsao" : "status-realizado"}">${s.previsao ? "Previsão" : "Realizado"}</td>
      <td><button class="btn-editar" onclick="editarSaidaPorId('${s.id}')">Editar</button></td>
    </tr>
  `).join("");
}

let CACHE_SAIDAS = [];
function editarSaidaPorId(id) {
  const registro = CACHE_SAIDAS.find((r) => r.id === id);
  if (registro) abrirModalEdicaoSaida(registro);
}

// ============================================================
// COTAS DE ARMAZÉM — capacidade alocada por cliente
// ============================================================
async function carregarCapacidade() {
  const { data: utilizacao } = await sb.from("vw_utilizacao_cliente").select("*").order("cliente_nome");
  const { data: cfg } = await sb.from("configuracoes").select("capacidade_total_ton").eq("id", 1).single();
  const CAPACIDADE = cfg?.capacidade_total_ton ?? 85000;

  const somaAlocada = (utilizacao ?? []).reduce((a, c) => a + Number(c.capacidade_alocada), 0);
  const saldoDisponivel = CAPACIDADE - somaAlocada;

  document.getElementById("cap-total").textContent = formatarTon(CAPACIDADE);
  document.getElementById("cap-alocada").textContent = formatarTon(somaAlocada);
  document.getElementById("cap-disponivel").textContent = formatarTon(saldoDisponivel);
  document.getElementById("cap-bar-fill").style.width = `${Math.min(100, (somaAlocada / CAPACIDADE) * 100).toFixed(1)}%`;
  document.getElementById("cap-bar-fill").style.background = somaAlocada > CAPACIDADE ? "#ff5252" : "var(--verde-2)";

  const tbody = document.getElementById("tbody-capacidade");
  tbody.innerHTML = (utilizacao ?? []).map(c => {
    const pct = c.capacidade_alocada > 0
      ? Math.min(100, Math.round(Number(c.saldo_atual) / Number(c.capacidade_alocada) * 100))
      : 0;
    const cor = pct > 95 ? "#ff5252" : pct > 75 ? "var(--laranja)" : "var(--verde-2)";
    return `<tr>
      <td style="font-weight:600">${c.cliente_nome}</td>
      <td>
        <div class="cap-input-wrap">
          <input type="number" class="cap-input" data-id="${c.cliente_id}"
            value="${Number(c.capacidade_alocada).toFixed(0)}" step="100" min="0"
            max="${CAPACIDADE}" />
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
  const { error } = await sb.from("clientes").insert({ nome });
  const msgEl = document.getElementById("clientes-msg");
  if (error) { msgEl.textContent = "Erro: " + error.message; return; }
  document.getElementById("cli-nome").value = "";
  await carregarClientes();
  await carregarClientesUsuarios();
});

async function carregarClientesUsuarios() {
  document.getElementById("lista-clientes").innerHTML =
    CLIENTES.map((c) => `<li>${c.nome}</li>`).join("");

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

  const totalE = eventos.filter(e => e.tipo === "entrada").reduce((a, e) => a + e.volume, 0);
  const totalS = eventos.filter(e => e.tipo === "saida").reduce((a, e) => a + e.volume, 0);

  document.getElementById("tl-resumo").innerHTML = `
    <div class="tl-kpi"><span class="tl-kpi-n">${eventos.filter(e=>e.tipo==="entrada").length}</span><span class="tl-kpi-l">chegadas · ${formatarTon(totalE)}</span></div>
    <div class="tl-kpi"><span class="tl-kpi-n" style="color:var(--laranja)">${eventos.filter(e=>e.tipo==="saida").length}</span><span class="tl-kpi-l">saídas · ${formatarTon(totalS)}</span></div>
    <div class="tl-kpi"><span class="tl-kpi-n">${formatarTon(totalE - totalS)}</span><span class="tl-kpi-l">saldo líquido</span></div>
  `;

  const lista = document.getElementById("tl-lista");
  if (!eventos.length) { lista.innerHTML = `<p class="texto-ajuda" style="padding:1rem 0">Nenhum evento nesse período.</p>`; return; }

  // agrupa por mês
  const porMes = {};
  eventos.forEach(e => {
    const mes = e.data.slice(0, 7);
    if (!porMes[mes]) porMes[mes] = [];
    porMes[mes].push(e);
  });

  lista.innerHTML = Object.entries(porMes).map(([mes, evs]) => {
    const [ano, m] = mes.split("-");
    const nomeMes = new Date(ano, m-1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const cards = evs.map(e => `
      <div class="tl-card tl-card-${e.tipo}">
        <div class="tl-card-top">
          <span class="tl-card-data">${new Date(e.data).toLocaleDateString("pt-BR", {day:"2-digit",month:"2-digit"})}</span>
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
  document.getElementById("modal-titulo").textContent = "Editar entrada (descarga de barcaça)";
  document.getElementById("modal-campos").innerHTML = `
    <div class="campo"><label>Data</label><input type="date" id="modal-data" value="${registro.data}" /></div>
    <div class="campo"><label>Turno</label>
      <select id="modal-turno">
        <option value="1" ${registro.hora == 1 ? "selected" : ""}>1º turno</option>
        <option value="2" ${registro.hora == 2 ? "selected" : ""}>2º turno</option>
        <option value="3" ${registro.hora == 3 ? "selected" : ""}>3º turno</option>
      </select>
    </div>
    <div class="campo"><label>Nº da barcaça</label><input type="text" id="modal-numero-bg" value="${registro.numero_bg ?? ""}" /></div>
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
      hora: Number(document.getElementById("modal-turno").value),
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
  document.getElementById("modal-titulo").textContent = "Editar saída (carregamento)";
  document.getElementById("modal-campos").innerHTML = `
    <div class="campo"><label>Data</label><input type="date" id="modal-data" value="${registro.data}" /></div>
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
      volume: Number(document.getElementById("modal-volume").value),
      previsao: document.getElementById("modal-previsao").checked,
    }).eq("id", registro.id);

    if (error) { msgEl.textContent = "Erro: " + error.message; return; }
    fecharModal();
    carregarSaidas();
    if (!document.getElementById("view-dashboard").classList.contains("oculto")) carregarDashboard();
  };
}
