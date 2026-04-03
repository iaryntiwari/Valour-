// ============================================================
//  GARMENT STORE MANAGEMENT SYSTEM — Express Backend
//  File: backend/server.js
// ============================================================

const express = require("express");
const mysql   = require("mysql2/promise");
const cors    = require("cors");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend static files from one level up
app.use(express.static(path.join(__dirname, "../frontend")));

// ── Database Pool ─────────────────────────────────────────
const db = mysql.createPool({
  host:     process.env.DB_HOST     || "localhost",
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",          // ← set your MySQL password
  database: process.env.DB_NAME     || "garment_store",
  waitForConnections: true,
  connectionLimit: 10,
});

// Helper: run query and return rows
const query = (sql, params) => db.execute(sql, params).then(([rows]) => rows);

// ── HEALTH ────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ status: "ok" }));

// ════════════════════════════════════════════════════════════
//  CLOTHES  (public catalog)
// ════════════════════════════════════════════════════════════

// GET /api/clothes  — with optional filters: type, fabric, size, status
app.get("/api/clothes", async (req, res) => {
  try {
    const { type, fabric, size, status = "In-Stock" } = req.query;
    let sql    = `SELECT c.*, d.name AS designer_name, b.branch_name
                  FROM clothes c
                  LEFT JOIN designers d ON c.designer_id = d.designer_id
                  LEFT JOIN branches  b ON c.branch_id   = b.branch_id
                  WHERE 1=1`;
    const params = [];

    if (status)  { sql += " AND c.status = ?";  params.push(status); }
    if (type)    { sql += " AND c.type   = ?";  params.push(type);   }
    if (fabric)  { sql += " AND c.fabric = ?";  params.push(fabric); }
    if (size)    { sql += " AND c.size   = ?";  params.push(size);   }

    sql += " ORDER BY c.cloth_id DESC";
    res.json(await query(sql, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/clothes/:id
app.get("/api/clothes/:id", async (req, res) => {
  try {
    const rows = await query(
      `SELECT c.*, d.name AS designer_name FROM clothes c
       LEFT JOIN designers d ON c.designer_id = d.designer_id
       WHERE c.cloth_id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/clothes  (admin — add new cloth)
app.post("/api/clothes", async (req, res) => {
  try {
    const { type, fabric, colour, size, price, mfd, designer_id, branch_id } = req.body;
    const result = await db.execute(
      `INSERT INTO clothes (type,fabric,colour,size,price,mfd,designer_id,branch_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [type, fabric, colour, size, price, mfd, designer_id || null, branch_id]
    );
    res.status(201).json({ cloth_id: result[0].insertId, message: "Cloth added" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/clothes/:id  (admin — update)
app.put("/api/clothes/:id", async (req, res) => {
  try {
    const { type, fabric, colour, size, price, mfd, status, designer_id, branch_id } = req.body;
    await db.execute(
      `UPDATE clothes SET type=?,fabric=?,colour=?,size=?,price=?,mfd=?,
       status=?,designer_id=?,branch_id=? WHERE cloth_id=?`,
      [type, fabric, colour, size, price, mfd, status, designer_id || null, branch_id, req.params.id]
    );
    res.json({ message: "Cloth updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/clothes/:id
app.delete("/api/clothes/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM clothes WHERE cloth_id=?", [req.params.id]);
    res.json({ message: "Cloth deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  CUSTOMERS
// ════════════════════════════════════════════════════════════

app.post("/api/customers", async (req, res) => {
  try {
    const { name, address, contact_no } = req.body;
    const [result] = await db.execute(
      "INSERT INTO customers (name,address,contact_no) VALUES (?,?,?)",
      [name, address, contact_no]
    );
    res.status(201).json({ customer_id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/customers", async (_, res) => {
  try { res.json(await query("SELECT * FROM customers ORDER BY created_at DESC")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  ORDERS
// ════════════════════════════════════════════════════════════

app.post("/api/orders", async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { customer_name, customer_address, customer_contact, items } = req.body;
    // Upsert customer
    let [cust] = await conn.execute(
      "SELECT customer_id FROM customers WHERE contact_no=?", [customer_contact]);
    let customer_id;
    if (cust.length) {
      customer_id = cust[0].customer_id;
    } else {
      const [r] = await conn.execute(
        "INSERT INTO customers (name,address,contact_no) VALUES (?,?,?)",
        [customer_name, customer_address, customer_contact]);
      customer_id = r.insertId;
    }

    const orderIds = [];
    for (const item of items) {
      const [cloth] = await conn.execute(
        "SELECT price, status FROM clothes WHERE cloth_id=?", [item.cloth_id]);
      if (!cloth.length || cloth[0].status === "Sold")
        throw new Error(`Cloth ${item.cloth_id} is unavailable`);

      const total_price = cloth[0].price * (item.quantity || 1);
      const [r2] = await conn.execute(
        "INSERT INTO orders (customer_id,cloth_id,quantity,total_price) VALUES (?,?,?,?)",
        [customer_id, item.cloth_id, item.quantity || 1, total_price]);
      orderIds.push(r2.insertId);

      // Mark as sold
      await conn.execute(
        "UPDATE clothes SET status='Sold', sold_date=CURDATE() WHERE cloth_id=?",
        [item.cloth_id]);
    }
    await conn.commit();
    res.status(201).json({ message: "Order placed", customer_id, orderIds });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ error: e.message });
  } finally { conn.release(); }
});

app.get("/api/orders", async (_, res) => {
  try {
    res.json(await query(
      `SELECT o.*, cu.name AS customer_name, cl.type, cl.fabric, cl.colour, cl.size
       FROM orders o
       JOIN customers cu ON o.customer_id = cu.customer_id
       JOIN clothes   cl ON o.cloth_id    = cl.cloth_id
       ORDER BY o.order_date DESC`
    ));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  COMPLAINTS
// ════════════════════════════════════════════════════════════

app.post("/api/complaints", async (req, res) => {
  try {
    const { customer_id, description } = req.body;
    const [r] = await db.execute(
      "INSERT INTO complaints (customer_id, description) VALUES (?,?)",
      [customer_id, description]);
    res.status(201).json({ complaint_id: r.insertId, message: "Complaint registered" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/complaints", async (_, res) => {
  try {
    res.json(await query(
      `SELECT cp.*, cu.name AS customer_name, cu.contact_no
       FROM complaints cp
       JOIN customers cu ON cp.customer_id = cu.customer_id
       ORDER BY cp.complaint_date DESC`
    ));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/complaints/:id", async (req, res) => {
  try {
    const { solution, status } = req.body;
    await db.execute(
      "UPDATE complaints SET solution=?, status=? WHERE complaint_id=?",
      [solution, status, req.params.id]);
    res.json({ message: "Complaint updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  BRANCHES, EMPLOYEES, DESIGNERS
// ════════════════════════════════════════════════════════════

app.get("/api/branches",   async (_, res) => {
  try { res.json(await query("SELECT * FROM branches")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/employees",  async (_, res) => {
  try {
    res.json(await query(
      `SELECT e.*, b.branch_name FROM employees e
       JOIN branches b ON e.branch_id = b.branch_id ORDER BY e.emp_id`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/designers",  async (_, res) => {
  try { res.json(await query("SELECT * FROM designers")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD ANALYTICS
// ════════════════════════════════════════════════════════════

app.get("/api/admin/dashboard", async (_, res) => {
  try {
    const [[stockRow]]   = await db.execute("SELECT COUNT(*) AS total_stock FROM clothes WHERE status='In-Stock'");
    const [[soldRow]]    = await db.execute("SELECT COUNT(*) AS total_sold  FROM clothes WHERE status='Sold'");
    const [[revenueRow]] = await db.execute("SELECT COALESCE(SUM(total_price),0) AS total_revenue FROM orders");
    const [[empRow]]     = await db.execute("SELECT COUNT(*) AS total_employees FROM employees");
    const [[custRow]]    = await db.execute("SELECT COUNT(*) AS total_customers FROM customers");
    const [[compRow]]    = await db.execute("SELECT COUNT(*) AS open_complaints FROM complaints WHERE status='Open'");

    const salesByType = await query(
      `SELECT cl.type, SUM(o.total_price) AS revenue, COUNT(*) AS units
       FROM orders o JOIN clothes cl ON o.cloth_id=cl.cloth_id
       GROUP BY cl.type ORDER BY revenue DESC`);

    const recentOrders = await query(
      `SELECT o.order_id, cu.name AS customer, cl.type, cl.colour, o.total_price, o.order_date
       FROM orders o
       JOIN customers cu ON o.customer_id=cu.customer_id
       JOIN clothes   cl ON o.cloth_id=cl.cloth_id
       ORDER BY o.order_date DESC LIMIT 5`);

    res.json({
      total_stock:      stockRow.total_stock,
      total_sold:       soldRow.total_sold,
      total_revenue:    revenueRow.total_revenue,
      total_employees:  empRow.total_employees,
      total_customers:  custRow.total_customers,
      open_complaints:  compRow.open_complaints,
      sales_by_type:    salesByType,
      recent_orders:    recentOrders,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`\n  🧵 Garment Store API running → http://localhost:${PORT}\n`)
);
