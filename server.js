const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "codealpha-demo-secret";

const dataDir = path.join(__dirname, "data");
require("fs").mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "store.db"));
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  image TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
`);

const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const insert = db.prepare(
    "INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)"
  );
  const seed = () => {
    insert.run("Wireless Headphones", "Comfortable wireless headphones with clear sound.", 1499, "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=700&q=80");
    insert.run("Smart Watch", "Everyday smartwatch with fitness and notification features.", 2499, "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80");
    insert.run("Running Shoes", "Lightweight running shoes designed for daily training.", 1999, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=80");
    insert.run("Backpack", "Durable everyday backpack with multiple compartments.", 1299, "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=80");
  };
  seed();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Login required." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired login." });
  }
}

app.get("/api/products", (req, res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.get("/api/products/:id", (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found." });
  res.json(product);
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must contain at least 6 characters." });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)"
    ).run(name.trim(), email.trim().toLowerCase(), hash);

    const user = { id: result.lastInsertRowid, name: name.trim(), email: email.trim().toLowerCase() };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "2h" });
    res.status(201).json({ user, token });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ message: "Email is already registered." });
    }
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").trim().toLowerCase());

  if (!user || !(await bcrypt.compare(password || "", user.password))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const safeUser = { id: user.id, name: user.name, email: user.email };
  const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: "2h" });
  res.json({ user: safeUser, token });
});

app.post("/api/orders", auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ message: "Cart is empty." });

  const getProduct = db.prepare("SELECT * FROM products WHERE id = ?");
  const createOrder = db.prepare("INSERT INTO orders (user_id, total) VALUES (?, ?)");
  const addItem = db.prepare(
    "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)"
  );

  try {
    db.exec("BEGIN TRANSACTION");
    let total = 0;
    const checkedItems = [];

    for (const item of items) {
      const product = getProduct.get(item.productId);
      const quantity = Number(item.quantity);

      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Invalid cart item.");
      }

      total += product.price * quantity;
      checkedItems.push({ product, quantity });
    }

    const order = createOrder.run(req.user.id, total);
    for (const item of checkedItems) {
      addItem.run(Number(order.lastInsertRowid), item.product.id, item.quantity, item.product.price);
    }

    const result = { id: Number(order.lastInsertRowid), total };
    db.exec("COMMIT");

    res.status(201).json({ message: "Order placed successfully.", order: result });
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(400).json({ message: err.message });
  }
});

app.get("/api/orders", auth, (req, res) => {
  const orders = db.prepare(
    "SELECT id, total, created_at FROM orders WHERE user_id = ? ORDER BY id DESC"
  ).all(req.user.id);
  res.json(orders);
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CodeAlpha E-commerce Store running at http://localhost:${PORT}`);
});
