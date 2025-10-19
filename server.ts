import express, { Request, Response } from "express";
import cors from "cors";

import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";

// --- Carrega variáveis do .env ---
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- Token do Mercado Pago vindo do .env ---
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

app.use(cors());
app.use(express.json());

// --- ENDPOINT CRIAR PIX ---
app.post("/api/pix", async (req: Request, res: Response) => {
  const { amount, description } = req.body;

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

    // Retorna dados PIX, incluindo qr_code_base64 para frontend exibir direto
    res.json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
    });
  } catch (err: unknown) {
    if (err instanceof Error) res.status(500).json({ error: err.message });
    else res.status(500).json({ error: "Erro desconhecido" });
  }
});

// --- ENDPOINT STATUS PIX / LINKS DIFERENTES POR PLANO ---
app.get("/api/pix/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const data: any = await response.json();
    console.log("Status PIX data:", data);

    // Define links diferentes por descrição do plano
    let link = "";
    if (data.status === "approved") {
      const description = data.description; // nome do plano enviado na criação do PIX

      switch (description) {
        case "Plano Starter":
          link = "https://drive.google.com/file/d/1Nt65HdH2G7MmzGD2n5Iv6xjEbI97Xkbo/view?usp=sharing"; //Simples
          break;
        case "Plano Completo":
          link = "https://drive.google.com/drive/folders/1y1xl2k1h_tXPLBhT8TcFjz_mcRklQxzz?usp=sharing";
          break;
        case "Plano Premium":
          link = "https://drive.google.com/drive/folders/1y1xl2k1h_tXPLBhT8TcFjz_mcRklQxzz?usp=sharing";
          break; }
    }

    res.json({
      id: data?.id,
      status: data?.status, // pending, in_process ou approved
      qr_code: data?.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data?.point_of_interaction?.transaction_data?.qr_code_base64,
      link,
    });
  } catch (err: unknown) {
    console.error("Erro no backend PIX:", err);
    if (err instanceof Error) res.status(500).json({ error: err.message });
    else res.status(500).json({ error: "Erro desconhecido" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend PIX rodando em http://localhost:${PORT}`);
});
