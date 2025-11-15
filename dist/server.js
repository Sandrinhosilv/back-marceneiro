"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const uuid_1 = require("uuid");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// --- Variáveis de Configuração ---
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// --- HEALTH CHECK (rota para o Render acordar) ---
app.get("/health", (req, res) => {
    res.status(200).json({ status: "alive" });
});
// --- FUNÇÃO PARA SALVAR LEAD COM APPS SCRIPT ---
const saveLeadWithAppsScript = async (email, whatsapp) => {
    if (!APPS_SCRIPT_URL) {
        console.warn("Variável APPS_SCRIPT_URL não definida. Contatos não serão salvos.");
        return;
    }
    try {
        console.log(`Tentando salvar lead via Apps Script para ${email}...`);
        const response = await (0, node_fetch_1.default)(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, whatsapp }),
        });
        const result = (await response.json());
        if (result.success) {
            console.log("✅ Contato salvo com sucesso no Google Sheets.");
        }
        else {
            console.error("❌ Erro do Apps Script:", result.error);
        }
    }
    catch (error) {
        console.error("🚨 Erro de rede ao enviar lead para Apps Script:", error);
    }
};
// --- ENDPOINT CRIAR PIX ---
app.post("/api/pix", async (req, res) => {
    const { amount, description, email, whatsapp } = req.body;
    if (!email || !whatsapp) {
        return res.status(400).json({ error: "E-mail e WhatsApp são obrigatórios." });
    }
    try {
        await saveLeadWithAppsScript(email, whatsapp);
        const mpBody = {
            transaction_amount: amount,
            description,
            payment_method_id: "pix",
            payer: { email: email },
        };
        const response = await (0, node_fetch_1.default)("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "X-Idempotency-Key": (0, uuid_1.v4)(),
            },
            body: JSON.stringify(mpBody),
        });
        const data = await response.json();
        if (!response.ok) {
            return res
                .status(response.status)
                .json({ error: data.message || "Erro ao criar PIX no Mercado Pago" });
        }
        res.json({
            id: data.id,
            status: data.status,
            qr_code: data.point_of_interaction?.transaction_data?.qr_code,
            qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
        });
    }
    catch (err) {
        console.error("Erro no ENDPOINT /api/pix:", err);
        if (err instanceof Error)
            res.status(500).json({ error: err.message });
        else
            res.status(500).json({ error: "Erro desconhecido" });
    }
});
// --- ENDPOINT STATUS PIX ---
app.get("/api/pix/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const response = await (0, node_fetch_1.default)(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
        const data = await response.json();
        console.log("Status PIX data:", data);
        res.json({
            id: data?.id,
            status: data?.status,
        });
    }
    catch (err) {
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
