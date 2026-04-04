import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const complaints = await client.query(
        `SELECT c.*, cu.name AS customer_name, cu.contact_no
         FROM complaints c
         JOIN customers cu ON c.customer_id = cu.customer_id
         ORDER BY c.complaint_date DESC`
      );
      res.status(200).json(complaints.rows);
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}