// Vercel Serverless Function — cria usuário no Supabase sem confirmar e-mail
// Arquivo: /api/criar-usuario.js (fica na raiz do projeto)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ erro: "E-mail e senha são obrigatórios" });
  }

  if (password.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres" });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ erro: "Configuração do servidor incompleta (SERVICE_ROLE_KEY ausente)" });
  }

  try {
    // Usa a Admin API do Supabase — cria usuário já confirmado
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // confirma automaticamente — sem e-mail necessário
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.msg || data?.message || data?.error_description || "Erro ao criar usuário";
      return res.status(400).json({ erro: msg });
    }

    return res.status(200).json({
      ok: true,
      usuario_id: data.id,
      email: data.email,
    });

  } catch (err) {
    return res.status(500).json({ erro: "Erro interno: " + err.message });
  }
}
