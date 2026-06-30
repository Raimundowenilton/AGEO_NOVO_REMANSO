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
  timeline: { label: "Linha do Tempo", roles: ["admin", "operacao", "cliente"] },
  entradas: { label: "Entradas (Barcaças)", roles: ["admin", "operacao"] },
  saidas: { label: "Saídas (Navios)", roles: ["admin", "operacao"] },
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
  if (chave === "timeline") carregarTimeline();
  if (chave === "entradas") carregarEntradas();
  if (chave === "saidas") carregarSaidas();
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

  const estoqueTotal = (estoqueClientes ?? []).reduce((acc, c) => acc + Number(c.saldo_atual), 0);
  const ocupacao = CAPACIDADE_TOTAL ? Math.round((estoqueTotal / CAPACIDADE_TOTAL) * 1000) / 10 : 0;

  document.getElementById("kpi-estoque").textContent = formatarTon(estoqueTotal);
  document.getElementById("kpi-capacidade").textContent = formatarTon(CAPACIDADE_TOTAL);
  const kpiOcupacao = document.getElementById("kpi-ocupacao");
  kpiOcupacao.textContent = `${ocupacao}%`;
  kpiOcupacao.classList.toggle("alerta-vermelho", ocupacao > 95);

  // tabela por cliente
  const tbody = document.getElementById("tbody-saldo-cliente");
  tbody.innerHTML = (estoqueClientes ?? []).map((c) => `
    <tr>
      <td>${c.cliente_nome}</td>
      <td>${formatarTon(c.total_entradas)}</td>
      <td>${formatarTon(c.total_saidas)}</td>
      <td>${formatarTon(c.quebra_total)}</td>
      <td style="color:var(--lima); font-weight:600">${formatarTon(c.saldo_atual)}</td>
    </tr>
  `).join("");

  // movimentos (realizado + previsão) para projeção
  const { data: entradas } = await sb.from("descargas_barcacas").select("cliente_id, data, previsao, qtd_bg");
  const { data: saidas } = await sb.from("saidas_navio").select("cliente_id, data, previsao, volume");

  const movimentos = [
    ...(entradas ?? []).map((e) => ({ data: e.data, previsao: e.previsao, entrada: Number(e.qtd_bg), saida: 0 })),
    ...(saidas ?? []).map((s) => ({ data: s.data, previsao: s.previsao, entrada: 0, saida: Number(s.volume) })),
  ];

  const { pontos, alertaCapacidade } = projetarEstoque(movimentos, CAPACIDADE_TOTAL);
  desenharGrafico(pontos);
  PONTOS_ESTOQUE_CACHE = pontos;

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

// ---------------- CLIENTES E USUÁRIOS (ADMIN) ----------------
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
document.getElementById("tl-filtrar").addEventListener("click", carregarTimeline);

async function carregarTimeline() {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!document.getElementById("tl-data-inicio").value) {
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 30);
    document.getElementById("tl-data-inicio").value = inicio.toISOString().slice(0, 10);
  }
  if (!document.getElementById("tl-data-fim").value) {
    const fim = new Date();
    fim.setDate(fim.getDate() + 30);
    document.getElementById("tl-data-fim").value = fim.toISOString().slice(0, 10);
  }

  const dataInicio = document.getElementById("tl-data-inicio").value;
  const dataFim = document.getElementById("tl-data-fim").value;
  const tipo = document.getElementById("tl-tipo").value;
  const clienteFiltro = document.getElementById("tl-cliente").value;

  // se o usuário é "cliente", trava o filtro no próprio cliente (RLS já protege,
  // mas isso evita mostrar o select de "todos" sem necessidade)
  const clienteEfetivo = PERFIL.role === "cliente" ? PERFIL.cliente_id : clienteFiltro;

  const eventos = [];

  // ---------- chegadas de comboios (entradas) ----------
  if (tipo === "todos" || tipo === "entrada") {
    let q = sb
      .from("descargas_barcacas")
      .select("data, hora, qtd_bg, numero_bg, previsao, clientes(nome), comboios(nome, produto)")
      .gte("data", dataInicio)
      .lte("data", dataFim);
    if (clienteEfetivo) q = q.eq("cliente_id", clienteEfetivo);
    const { data } = await q;
    (data ?? []).forEach((d) => {
      eventos.push({
        tipo: "entrada",
        data: d.data,
        titulo: d.comboios?.nome || "Comboio (sem nome)",
        subtitulo: `${d.clientes?.nome ?? "-"} · ${d.comboios?.produto ?? ""}`,
        volume: Number(d.qtd_bg),
        previsao: d.previsao,
      });
    });
  }

  // ---------- saídas de navios ----------
  if (tipo === "todos" || tipo === "saida") {
    let q = sb
      .from("saidas_navio")
      .select("data, volume, previsao, clientes(nome), navios(nome, produto)")
      .gte("data", dataInicio)
      .lte("data", dataFim);
    if (clienteEfetivo) q = q.eq("cliente_id", clienteEfetivo);
    const { data } = await q;
    (data ?? []).forEach((s) => {
      eventos.push({
        tipo: "saida",
        data: s.data,
        titulo: s.navios?.nome || "Navio (sem nome)",
        subtitulo: `${s.clientes?.nome ?? "-"} · ${s.navios?.produto ?? ""}`,
        volume: Number(s.volume),
        previsao: s.previsao,
      });
    });
  }

  eventos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  // ---------- resumo ----------
  const totalEntrada = eventos.filter((e) => e.tipo === "entrada").reduce((a, e) => a + e.volume, 0);
  const totalSaida = eventos.filter((e) => e.tipo === "saida").reduce((a, e) => a + e.volume, 0);
  document.getElementById("tl-resumo").innerHTML = `
    <span><strong>${eventos.filter((e) => e.tipo === "entrada").length}</strong> chegadas · ${formatarTon(totalEntrada)}</span>
    <span><strong>${eventos.filter((e) => e.tipo === "saida").length}</strong> saídas · ${formatarTon(totalSaida)}</span>
  `;

  // ---------- lista cronológica ----------
  const lista = document.getElementById("tl-lista");
  if (eventos.length === 0) {
    lista.innerHTML = `<p class="texto-ajuda">Nenhum evento encontrado nesse período.</p>`;
    return;
  }

  lista.innerHTML = eventos.map((e) => `
    <div class="tl-item tl-item-${e.tipo}">
      <div class="tl-marcador"></div>
      <div class="tl-conteudo">
        <div class="tl-linha-topo">
          <span class="tl-data">${new Date(e.data).toLocaleDateString("pt-BR")}</span>
          <span class="tl-tag tl-tag-${e.tipo}">${e.tipo === "entrada" ? "Chegada · Comboio" : "Saída · Navio"}</span>
          ${e.previsao ? '<span class="tl-tag tl-tag-previsao">Previsão</span>' : ""}
        </div>
        <p class="tl-titulo">${e.titulo}</p>
        <p class="tl-subtitulo">${e.subtitulo} — ${formatarTon(e.volume)}</p>
      </div>
    </div>
  `).join("");
}

// ============================================================
// MODAL DE EDIÇÃO (genérico para entradas e saídas)
// ============================================================
let EDICAO_ATUAL = null; // { tabela, id, onSalvar }

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
