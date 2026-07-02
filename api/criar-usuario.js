// API Admin — criar/excluir/redefinir senha de usuários sem confirmação de e-mail

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ erro: "SERVICE_ROLE_KEY não configurada no Vercel." });
  }

  const headers = {
    "Content-Type": "application/json",
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  };

  // ── POST /api/criar-usuario?acao=criar ──────────────────────
  if (req.method === "POST") {
    const { email, password, acao, usuario_id } = req.body ?? {};

    // Excluir usuário
    if (acao === "excluir" && usuario_id) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuario_id}`, {
        method: "DELETE",
        headers,
      });
      if (!r.ok) {
        const d = await r.json();
        return res.status(400).json({ erro: d?.msg || d?.message || "Erro ao excluir" });
      }
      return res.status(200).json({ ok: true });
    }

    // Redefinir senha
    if (acao === "redefinir" && usuario_id && password) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuario_id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const d = await r.json();
        return res.status(400).json({ erro: d?.msg || d?.message || "Erro ao redefinir senha" });
      }
      return res.status(200).json({ ok: true });
    }

    // Criar usuário (padrão)
    if (!email || !password) {
      return res.status(400).json({ erro: "E-mail e senha são obrigatórios" });
    }
    if (password.length < 6) {
      return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres" });
    }

    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const d = await r.json();
    if (!r.ok) {
      return res.status(400).json({ erro: d?.msg || d?.message || d?.error_description || "Erro ao criar usuário" });
    }
    return res.status(200).json({ ok: true, usuario_id: d.id, email: d.email });
  }

  return res.status(405).json({ erro: "Método não permitido" });
}
