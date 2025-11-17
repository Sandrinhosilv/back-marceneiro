import express, { Request, Response } from "express";
import cors from "cors";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- Variáveis de Configuração ---
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

interface AppsScriptResponse {
  success: boolean;
  error?: string;
  message?: string;
}

app.use(cors());
app.use(express.json());

// --- HEALTH CHECK (rota para o Render acordar) ---
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "alive" });
});

// --- FUNÇÃO PARA SALVAR LEAD COM APPS SCRIPT (ATUALIZADA) ---
const saveLeadWithAppsScript = async (
  email: string,
  whatsapp: string,
  description?: string,
  paymentId?: string,
  pixCopyPaste?: string
) => {
  if (!APPS_SCRIPT_URL) {
    console.warn("Variável APPS_SCRIPT_URL não definida. Contatos não serão salvos.");
    return;
  }

  try {
    console.log(`Tentando salvar lead via Apps Script para ${email}...`);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        whatsapp,
        description,
        paymentId,
        pixCopyPaste,
      }),
    });

    const result = (await response.json()) as AppsScriptResponse;

    if (result.success) {
      console.log("✅ Contato salvo com sucesso no Google Sheets.");
    } else {
      console.error("❌ Erro do Apps Script:", result.error);
    }
  } catch (error) {
    console.error("🚨 Erro de rede ao enviar lead para Apps Script:", error);
  }
};

// --- ENDPOINT CRIAR PIX (ATUALIZADO) ---
app.post("/api/pix", async (req: Request, res: Response) => {
  const { amount, description, email, whatsapp } = req.body;

  if (!email || !whatsapp) {
    return res.status(400).json({ error: "E-mail e WhatsApp são obrigatórios." });
  }

  try {
    const mpBody = {
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: { email: email },
    };

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": uuid(),
      },
      body: JSON.stringify(mpBody),
    });

    const data: any = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: data.message || "Erro ao criar PIX no Mercado Pago" });
    }

    // Salva lead + pagamento na planilha
    await saveLeadWithAppsScript(
      email,
      whatsapp,
      description,
      data.id, // ID do pagamento
      data.point_of_interaction?.transaction_data?.qr_code // PIX Copia e Cola
    );

    res.json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
    });
  } catch (err: unknown) {
    console.error("Erro no ENDPOINT /api/pix:", err);
    if (err instanceof Error)
      res.status(500).json({ error: err.message });
    else
      res.status(500).json({ error: "Erro desconhecido" });
  }
});

// --- ENDPOINT STATUS PIX ---
app.get("/api/pix/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${id}`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );

    const data: any = await response.json();
    console.log("Status PIX data:", data);

    res.json({
      id: data?.id,
      status: data?.status,
    });
  } catch (err: unknown) {
    console.error("Erro no ENDPOINT /api/pix/:id:", err);
    if (err instanceof Error)
      res.status(500).json({ error: err.message });
    else
      res.status(500).json({ error: "Erro desconhecido" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend PIX rodando em http://localhost:${PORT}`);
});
