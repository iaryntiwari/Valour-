import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const clothes = await client.query(
        `SELECT c.*, d.name AS designer_name, b.branch_name
         FROM clothes c
         LEFT JOIN designers d ON c.designer_id = d.designer_id
         LEFT JOIN branches  b ON c.branch_id   = b.branch_id
         ORDER BY c.cloth_id`
      );
      res.status(200).json(clothes.rows);
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}