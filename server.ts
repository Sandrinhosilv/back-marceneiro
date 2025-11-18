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
const WEBHOOK_URL = process.env.WEBHOOK_URL;

interface AppsScriptResponse {
  success: boolean;
  error?: string;
  message?: string;
}

app.use(cors());
app.use(express.json());

// --- HEALTH ---
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "alive" });
});

// --- HASH SHA256 CAPI ---
const hashSHA256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

// --- SALVAR LEAD ---
const saveLeadWithAppsScript = async (
  email: string,
  whatsapp: string,
  description?: string,
  paymentId?: string,
  pixCopyPaste?: string,
  utms?: Record<string, string>,
  purchaseSent?: boolean
) => {
  if (!APPS_SCRIPT_URL) return;

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        whatsapp,
        description,
        paymentId,
        pixCopyPaste,
        purchase_sent: purchaseSent ? "true" : "false",
        ...utms,
      }),
    });

    const result = (await response.json()) as AppsScriptResponse;
    console.log(result.success ? "✅ Lead salvo/atualizado no Google Sheets." : `❌ Erro Apps Script: ${result.error}`);
  } catch (error) {
    console.error("Erro ao enviar lead para Apps Script:", error);
  }
};

// --- FACEBOOK CAPI ---
const sendFacebookEvent = async (
  eventName: "InitiateCheckout" | "Purchase",
  email: string,
  whatsapp: string,
  amount: number,
  utms: Record<string, string>
) => {
  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) return;

  const payload = {
    data: [
      {
        event_name: eventName,
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
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    console.log(`✅ Evento ${eventName} enviado ao Facebook CAPI`);
  } catch (error) {
    console.error("Erro CAPI:", error);
  }
};

// --- WEBHOOK EXTERNO ---
const sendToWebhook = async (payload: Record<string, any>) => {
  if (!WEBHOOK_URL) return;
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(response.ok ? "✅ Lead enviado para Webhook externo" : `❌ Erro Webhook: ${response.statusText}`);
  } catch (error) {
    console.error("Erro ao enviar para webhook:", error);
  }
};

// --- CRIAR PIX ---
app.post("/api/pix", async (req: Request, res: Response) => {
  const { amount, description, email, whatsapp, ...rest } = req.body;
  if (!email || !whatsapp) return res.status(400).json({ error: "E-mail e WhatsApp são obrigatórios." });

  const utms: Record<string, string> = {};
  for (const key in rest) if (key.startsWith("utm_") || ["fbclid", "utm_id", "i"].includes(key)) utms[key] = rest[key];

  if (utms.utm_campaign) {
    const [campaign_name, campaign_id] = utms.utm_campaign.split("|");
    utms.campaign_name = campaign_name || utms.utm_campaign;
    utms.campaign_id = campaign_id || "";
  }
  if (utms.utm_medium) {
    const [adset_name, adset_id] = utms.utm_medium.split("|");
    utms.adset_name = adset_name || utms.utm_medium;
    utms.adset_id = adset_id || "";
  }
  if (utms.utm_content) {
    const [ad_name, ad_id] = utms.utm_content.split("|");
    utms.ad_name = ad_name || utms.utm_content;
    utms.ad_id = ad_id || "";
  }
  utms.placement = utms.utm_term || "";

  try {
    const mpBody = { transaction_amount: amount, description, payment_method_id: "pix", payer: { email } };
    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": uuid() },
      body: JSON.stringify(mpBody),
    });
    const data: any = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || "Erro ao criar PIX" });

    // Salvar lead
    await saveLeadWithAppsScript(email, whatsapp, description, data.id, data.point_of_interaction?.transaction_data?.qr_code, utms, false);

    // Disparar InitiateCheckout
    await sendFacebookEvent("InitiateCheckout", email, whatsapp, amount, utms);

    // Webhook externo
    await sendToWebhook({ email, whatsapp, description, amount, paymentId: data.id, pixCopyPaste: data.point_of_interaction?.transaction_data?.qr_code, ...utms });

    res.json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
    });
  } catch (err: unknown) {
    console.error("Erro no /api/pix:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro desconhecido" });
  }
});

// --- STATUS PIX (dispara Purchase quando aprovado) ---
app.get("/api/pix/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    const data: any = await response.json();
    console.log("Status PIX:", data);

    // Se aprovado e ainda não enviou Purchase
    if (data.status === "approved" && !data.metadata?.purchase_sent) {
      const { email, whatsapp, amount, utms } = data.metadata || {};
      if (email && whatsapp && amount) {
        await sendFacebookEvent("Purchase", email, whatsapp, amount, utms || {});
        // Marcar como enviado
        await saveLeadWithAppsScript(email, whatsapp, data.description, data.id, data.point_of_interaction?.transaction_data?.qr_code, utms || {}, true);
      }
    }

    res.json({ id: data?.id, status: data?.status });
  } catch (err: unknown) {
    console.error("Erro no /api/pix/:id:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro desconhecido" });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend PIX rodando em http://localhost:${PORT}`));
