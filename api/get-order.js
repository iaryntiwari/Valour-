import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const orders = await client.query(
        `SELECT o.*, cu.name AS customer_name, cl.type, cl.fabric, cl.colour, cl.size
         FROM orders o
         JOIN customers cu ON o.customer_id = cu.customer_id
         JOIN clothes   cl ON o.cloth_id    = cl.cloth_id
         ORDER BY o.order_date DESC`
      );
      res.status(200).json(orders.rows );
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}