import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const stockRow = await client.query(
      "SELECT COUNT(*) AS total_stock FROM clothes WHERE status='In-Stock'"
    );
    const soldRow = await client.query(
      "SELECT COUNT(*) AS total_sold FROM clothes WHERE status='Sold'"
    );
    const revenueRow = await client.query(
      "SELECT COALESCE(SUM(total_price),0) AS total_revenue FROM orders"
    );
    const empRow = await client.query(
      "SELECT COUNT(*) AS total_employees FROM employees"
    );
    const custRow = await client.query(
      "SELECT COUNT(*) AS total_customers FROM customers"
    );
    const compRow = await client.query(
      "SELECT COUNT(*) AS open_complaints FROM complaints WHERE status='Open'"
    );

    const salesByType = await client.query(
      `SELECT cl.type, SUM(o.total_price) AS revenue, COUNT(*) AS units
       FROM orders o
       JOIN clothes cl ON o.cloth_id = cl.cloth_id
       GROUP BY cl.type
       ORDER BY revenue DESC`
    );

    const recentOrders = await client.query(
      `SELECT o.order_id, cu.name AS customer, cl.type, cl.colour, o.total_price, o.order_date
       FROM orders o
       JOIN customers cu ON o.customer_id = cu.customer_id
       JOIN clothes   cl ON o.cloth_id = cl.cloth_id
       ORDER BY o.order_date DESC
       LIMIT 5`
    );

    res.status(200).json({
      total_stock: parseInt(stockRow.rows[0].total_stock, 10),
      total_sold: parseInt(soldRow.rows[0].total_sold, 10),
      total_revenue: parseFloat(revenueRow.rows[0].total_revenue),
      total_employees: parseInt(empRow.rows[0].total_employees, 10),
      total_customers: parseInt(custRow.rows[0].total_customers, 10),
      open_complaints: parseInt(compRow.rows[0].open_complaints, 10),
      sales_by_type: salesByType.rows,
      recent_orders: recentOrders.rows,
    });
    return;
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}