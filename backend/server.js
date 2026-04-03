// ============================================================
//  GARMENT STORE MANAGEMENT SYSTEM — Express Backend
//  File: backend/server.js
// ============================================================


import express from "express";
import cors from "cors";
import path from "path";
import pool from "./lib/db.js";



const app  = express();
const PORT = process.env.PORT || 3000;


// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend static files from one level up
app.use(express.static(path.join(process.cwd(), "../")));

// ── Database Helper ─────────────────────────────────────────
const query = (text, params) => pool.query(text, params).then(res => res.rows);

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
    let paramIndex = 1;

    if (status)  { sql += ` AND c.status = $${paramIndex++}`;  params.push(status); }
    if (type)    { sql += ` AND c.type   = $${paramIndex++}`;  params.push(type);   }
    if (fabric)  { sql += ` AND c.fabric = $${paramIndex++}`;  params.push(fabric); }
    if (size)    { sql += ` AND c.size   = $${paramIndex++}`;  params.push(size);   }

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
       WHERE c.cloth_id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/clothes  (admin — add new cloth)
app.post("/api/clothes", async (req, res) => {
  try {
    const { type, fabric, colour, size, price, mfd, designer_id, branch_id } = req.body;
    const result = await query(
      `INSERT INTO clothes (type,fabric,colour,size,price,mfd,designer_id,branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING cloth_id`,
      [type, fabric, colour, size, price, mfd, designer_id || null, branch_id]
    );
    res.status(201).json({ cloth_id: result[0].cloth_id, message: "Cloth added" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/clothes/:id  (admin — update)
app.put("/api/clothes/:id", async (req, res) => {
  try {
    const { type, fabric, colour, size, price, mfd, status, designer_id, branch_id } = req.body;
    await query(
      `UPDATE clothes SET type=$1,fabric=$2,colour=$3,size=$4,price=$5,mfd=$6,
       status=$7,designer_id=$8,branch_id=$9 WHERE cloth_id=$10`,
      [type, fabric, colour, size, price, mfd, status, designer_id || null, branch_id, req.params.id]
    );
    res.json({ message: "Cloth updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/clothes/:id
app.delete("/api/clothes/:id", async (req, res) => {
  try {
    await query("DELETE FROM clothes WHERE cloth_id=$1", [req.params.id]);
    res.json({ message: "Cloth deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  CUSTOMERS
// ════════════════════════════════════════════════════════════

app.post("/api/customers", async (req, res) => {
  try {
    const { name, address, contact_no } = req.body;
    const result = await query(
      "INSERT INTO customers (name,address,contact_no) VALUES ($1,$2,$3) RETURNING customer_id",
      [name, address, contact_no]
    );
    res.status(201).json({ customer_id: result[0].customer_id });
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { customer_name, customer_address, customer_contact, items } = req.body;
    // Upsert customer
    let cust = await client.query(
      "SELECT customer_id FROM customers WHERE contact_no=$1", [customer_contact]);
    let customer_id;
    if (cust.rows.length) {
      customer_id = cust.rows[0].customer_id;
    } else {
      const result = await client.query(
        "INSERT INTO customers (name,address,contact_no) VALUES ($1,$2,$3) RETURNING customer_id",
        [customer_name, customer_address, customer_contact]);
      customer_id = result.rows[0].customer_id;
    }

    const orderIds = [];
    for (const item of items) {
      const cloth = await client.query(
        "SELECT price, status FROM clothes WHERE cloth_id=$1", [item.cloth_id]);
      if (!cloth.rows.length || cloth.rows[0].status === "Sold")
        throw new Error(`Cloth ${item.cloth_id} is unavailable`);

      const total_price = cloth.rows[0].price * (item.quantity || 1);
      const result = await client.query(
        "INSERT INTO orders (customer_id,cloth_id,quantity,total_price) VALUES ($1,$2,$3,$4) RETURNING order_id",
        [customer_id, item.cloth_id, item.quantity || 1, total_price]);
      orderIds.push(result.rows[0].order_id);

      // Mark as sold
      await client.query(
        "UPDATE clothes SET status='Sold', sold_date=CURRENT_DATE WHERE cloth_id=$1",
        [item.cloth_id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ message: "Order placed", customer_id, orderIds });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
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
    const result = await query(
      "INSERT INTO complaints (customer_id, description) VALUES ($1,$2) RETURNING complaint_id",
      [customer_id, description]);
    res.status(201).json({ complaint_id: result[0].complaint_id, message: "Complaint registered" });
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
    await query(
      "UPDATE complaints SET solution=$1, status=$2 WHERE complaint_id=$3",
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
    const stockRow = await query("SELECT COUNT(*) AS total_stock FROM clothes WHERE status='In-Stock'");
    const soldRow = await query("SELECT COUNT(*) AS total_sold FROM clothes WHERE status='Sold'");
    const revenueRow = await query("SELECT COALESCE(SUM(total_price),0) AS total_revenue FROM orders");
    const empRow = await query("SELECT COUNT(*) AS total_employees FROM employees");
    const custRow = await query("SELECT COUNT(*) AS total_customers FROM customers");
    const compRow = await query("SELECT COUNT(*) AS open_complaints FROM complaints WHERE status='Open'");

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
      total_stock:      parseInt(stockRow[0].total_stock),
      total_sold:       parseInt(soldRow[0].total_sold),
      total_revenue:    parseFloat(revenueRow[0].total_revenue),
      total_employees:  parseInt(empRow[0].total_employees),
      total_customers:  parseInt(custRow[0].total_customers),
      open_complaints:  parseInt(compRow[0].open_complaints),
      sales_by_type:    salesByType,
      recent_orders:    recentOrders,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`\n  🧵 Garment Store API running → http://localhost:${PORT}\n`)
);

console.log("Database URL:", process.env.DATABASE_URL)

