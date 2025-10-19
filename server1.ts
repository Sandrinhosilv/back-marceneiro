import express, { Request, Response } from "express";
import cors from "cors";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- Domínios permitidos ---
const allowedOrigins = [
  "https://marceneiro10.netlify.app",             // produção
  "http://localhost:3000",                 // dev local
  "https://back-marceneiro.netlify.app",   // backend no Netlify
];

// --- Configuração do CORS ---
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn("🚫 Bloqueado pelo CORS:", origin);
      callback(new Error("Não permitido pelo CORS"));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions)); // aplica CORS globalmente
app.use(express.json());

// --- Token do Mercado Pago ---
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// --- ENDPOINT CRIAR PIX ---
app.post("/api/pix", async (req: Request, res: Response) => {
  const { amount, description } = req.body;

  if (!amount || !description) {
    return res.status(400).json({ error: "amount e description são obrigatórios" });
  }

  try {
    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": uuid(),
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description,
        payment_method_id: "pix",
        payer: { email: "teste@email.com" },
      }),
    });

    const data: any = await response.json();

    // Validação extra para erro no retorno do Mercado Pago
    if (!data?.point_of_interaction?.transaction_data?.qr_code_base64) {
      console.error("❌ Falha ao gerar PIX:", data);
      return res.status(500).json({
        error: "Erro ao gerar o PIX",
        detalhes: data,
      });
    }

    res.json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err: unknown) {
    console.error("⚠️ Erro ao gerar PIX:", err);
    if (err instanceof Error) res.status(500).json({ error: err.message });
    else res.status(500).json({ error: "Erro desconhecido" });
  }
});

// --- ENDPOINT STATUS PIX ---
app.get("/api/pix/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const data: any = await response.json();

    let link = "";
    if (data.status === "approved") {
      switch (data.description) {
        case "Plano Starter":
          link = "https://drive.google.com/file/d/1Nt65HdH2G7MmzGD2n5Iv6xjEbI97Xkbo/view?usp=drive_link";
          break;
        case "Plano Completo":
          link = "https://drive.google.com/file/d/1fzcBwW1nzQHlXAksD5uW2fqYcz7e3KIv/view?usp=sharing";
          break;
        case "Plano Premium":
          link = "https://drive.google.com/drive/u/1/folders/1y1xl2k1h_tXPLBhT8TcFjz_mcRklQxzz";
          break;
      }
    }

    res.json({
      id: data?.id,
      status: data?.status,
      link,
    });
  } catch (err: unknown) {
    console.error("⚠️ Erro ao verificar status PIX:", err);
    if (err instanceof Error) res.status(500).json({ error: err.message });
    else res.status(500).json({ error: "Erro desconhecido" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend PIX rodando em http://localhost:${PORT}`);
});
