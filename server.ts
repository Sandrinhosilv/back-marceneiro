import express, { Request, Response } from "express";
import cors from "cors";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import * as dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- Variáveis de Configuração ---
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

interface AppsScriptResponse {
  success: boolean;
  error?: string;
  message?: string;
}

app.use(cors());
app.use(express.json());

// --- HEALTH CHECK ---
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "alive" });
});

// --- HASH SHA256 para Facebook CAPI ---
const hashSHA256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

// --- FUNÇÃO PARA SALVAR LEAD COM APPS SCRIPT ---
const saveLeadWithAppsScript = async (
  email: string,
  whatsapp: string,
  description?: string,
  paymentId?: string,
  pixCopyPaste?: string,
  utms?: Record<string, string>
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
        ...utms,
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

// --- FUNÇÃO PARA ENVIAR EVENTO PARA FACEBOOK CAPI ---
const sendFacebookConversion = async (
  email: string,
  whatsapp: string,
  amount: number,
  utms: Record<string, string>
) => {
  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) return;

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        user_data: {
          em: [hashSHA256(email)],
          ph: [hashSHA256(whatsapp.replace(/\D/g, ""))],
        },
        custom_data: {
          currency: "BRL",
          value: amount,
          ...utms,
        },
        action_source: "website",
      },
    ],
  };

  try {
    await fetch(
      `https://graph.facebook.com/v16.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    console.log("✅ Evento enviado para o Facebook CAPI");
  } catch (error) {
    console.error("🚨 Erro ao enviar evento para Facebook CAPI:", error);
  }
};

// --- ENDPOINT CRIAR PIX ---
app.post("/api/pix", async (req: Request, res: Response) => {
  const { amount, description, email, whatsapp, ...rest } = req.body;

  if (!email || !whatsapp) {
    return res.status(400).json({ error: "E-mail e WhatsApp são obrigatórios." });
  }

  // --- Captura todas as UTMs ---
  const utms: Record<string, string> = {};
  for (const key in rest) {
    if (key.startsWith("utm_")) utms[key] = rest[key];
  }

  // --- Separar dados de campanha, adset e anúncio do Facebook ---
  if (utms.utm_campaign) {
    const [campaign_name, campaign_id] = utms.utm_campaign.split("|");
    utms.campaign_name = campaign_name;
    utms.campaign_id = campaign_id;
  }
  if (utms.utm_medium) {
    const [adset_name, adset_id] = utms.utm_medium.split("|");
    utms.adset_name = adset_name;
    utms.adset_id = adset_id;
  }
  if (utms.utm_content) {
    const [ad_name, ad_id] = utms.utm_content.split("|");
    utms.ad_name = ad_name;
    utms.ad_id = ad_id;
  }
  utms.placement = utms.utm_term || "";

  try {
    const mpBody = {
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: { email },
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

    // Salva lead + pagamento + UTMs na planilha
    await saveLeadWithAppsScript(
      email,
      whatsapp,
      description,
      data.id,
      data.point_of_interaction?.transaction_data?.qr_code,
      utms
    );

    // Envia evento para o Facebook CAPI
    await sendFacebookConversion(email, whatsapp, amount, utms);

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
