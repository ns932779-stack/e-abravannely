import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { MercadoPagoConfig, Preference } from "mercadopago";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const db = new Database("e_abravannely.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  icon TEXT DEFAULT '👕',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (!count) {
  const insert = db.prepare(`INSERT INTO products
    (name, category, description, price_cents, stock, icon) VALUES (?, ?, ?, ?, ?, ?)`);
  const seed = [
    ["Camiseta Premium E.A.", "Camisetas", "Camiseta premium de visual clean.", 8990, 20, "👕"],
    ["Moletom Premium", "Moletons", "Moletom confortável e marcante.", 19990, 12, "🧥"],
    ["Calça Cargo Tech", "Calças", "Cargo urbana com estética tech.", 15990, 8, "👖"],
    ["Tênis Street", "Tênis", "Tênis street para completar o look.", 34990, 6, "👟"],
    ["Short Urban", "Shorts", "Short urbano versátil.", 11990, 14, "🩳"],
    ["Boné Signature", "Bonés", "Boné com identidade E.A.", 7990, 20, "🧢"]
  ];
  const tx = db.transaction(() => seed.forEach(x => insert.run(...x)));
  tx();
}

function money(cents) { return (cents / 100).toLocaleString("pt-BR", { style:"currency", currency:"BRL" }); }
function admin(req, res, next) {
  const given = req.get("x-admin-password") || "";
  if (!process.env.ADMIN_PASSWORD || given !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}
function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Carrinho vazio.");
  return items.map(i => ({ id: Number(i.id), quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)) }));
}

app.get("/api/products", (req, res) => {
  const rows = db.prepare(`SELECT id,name,category,description,price_cents,stock,icon
    FROM products WHERE active=1 ORDER BY id DESC`).all();
  res.json(rows);
});

app.get("/api/orders", admin, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items_json), total: money(r.total_cents) })));
});

app.post("/api/products", admin, (req, res) => {
  const { name, category, description="", price, stock=0, icon="👕" } = req.body;
  const cents = Math.round(Number(price) * 100);
  if (!name || !category || !Number.isFinite(cents) || cents <= 0) return res.status(400).json({error:"Dados inválidos."});
  const info = db.prepare(`INSERT INTO products (name,category,description,price_cents,stock,icon)
    VALUES (?,?,?,?,?,?)`).run(name, category, description, cents, Number(stock)||0, icon);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete("/api/products/:id", admin, (req, res) => {
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(Number(req.params.id));
  res.json({ ok:true });
});

app.post("/api/checkout", async (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer?.name || !customer?.email) return res.status(400).json({error:"Nome e e-mail são obrigatórios."});
    const clean = normalizeItems(items);

    const get = db.prepare("SELECT * FROM products WHERE id=? AND active=1");
    const lines = clean.map(i => {
      const p = get.get(i.id);
      if (!p) throw new Error("Produto não encontrado.");
      if (p.stock < i.quantity) throw new Error(`Estoque insuficiente para ${p.name}.`);
      return { ...p, quantity:i.quantity };
    });
    const total = lines.reduce((s, p) => s + p.price_cents * p.quantity, 0);
    const orderId = "EA-" + crypto.randomUUID();

    db.prepare(`INSERT INTO orders
      (id,customer_name,customer_email,customer_phone,address,total_cents,items_json)
      VALUES (?,?,?,?,?,?,?)`).run(
        orderId, customer.name, customer.email, customer.phone||"", customer.address||"",
        total, JSON.stringify(lines.map(p => ({id:p.id,name:p.name,price_cents:p.price_cents,quantity:p.quantity})))
      );

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(201).json({
        order_id: orderId,
        payment_ready: false,
        message: "Pedido criado. Configure MP_ACCESS_TOKEN para ativar o pagamento."
      });
    }

    const client = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });
    const preference = new Preference(client);
    const response = await preference.create({
      body: {
        external_reference: orderId,
        payer: { name: customer.name, email: customer.email },
        items: lines.map(p => ({
          id: String(p.id),
          title: p.name,
          description: p.description || p.name,
          quantity: p.quantity,
          unit_price: p.price_cents / 100,
          currency_id: "BRL"
        })),
        back_urls: {
          success: `${baseUrl}/?status=success&order=${encodeURIComponent(orderId)}`,
          pending: `${baseUrl}/?status=pending&order=${encodeURIComponent(orderId)}`,
          failure: `${baseUrl}/?status=failure&order=${encodeURIComponent(orderId)}`
        },
        notification_url: process.env.MP_WEBHOOK_URL || `${baseUrl}/api/webhooks/mercadopago`,
        auto_return: "approved"
      }
    });

    db.prepare("UPDATE orders SET mp_preference_id=? WHERE id=?").run(response.id, orderId);
    res.status(201).json({ order_id: orderId, payment_ready: true, checkout_url: response.init_point });
  } catch (e) {
    res.status(400).json({ error: e.message || "Não foi possível criar o pedido." });
  }
});

app.post("/api/webhooks/mercadopago", async (req, res) => {
  // O Mercado Pago chama este endpoint para avisar mudanças de pagamento.
  // Para produção, valide também a assinatura conforme a configuração de segurança
  // da sua conta e consulte o pagamento na API antes de alterar o pedido.
  try {
    const paymentId = req.body?.data?.id || req.query?.id;
    if (!paymentId || !process.env.MP_ACCESS_TOKEN) return res.sendStatus(200);

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!response.ok) return res.sendStatus(200);
    const payment = await response.json();
    const orderId = payment.external_reference;
    if (!orderId) return res.sendStatus(200);

    db.prepare(`UPDATE orders SET payment_status=?, mp_payment_id=?,
      status=CASE WHEN ?='approved' THEN 'paid' ELSE status END WHERE id=?`)
      .run(payment.status || "pending", String(payment.id), payment.status || "pending", orderId);

    if (payment.status === "approved") {
      const order = db.prepare("SELECT items_json FROM orders WHERE id=?").get(orderId);
      if (order) {
        const items = JSON.parse(order.items_json);
        const reduce = db.prepare("UPDATE products SET stock=MAX(stock-?,0) WHERE id=?");
        const tx = db.transaction(() => items.forEach(i => reduce.run(i.quantity, i.id)));
        tx();
      }
    }
  } catch {}
  res.sendStatus(200);
});

app.get("/api/health", (req,res) => res.json({ok:true, service:"E Abravannely"}));

app.listen(port, () => console.log(`E Abravannely em ${baseUrl}`));
