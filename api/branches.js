import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const branches = await client.query(`SELECT * FROM branches ORDER BY branch_id`);
      res.status(200).json(branches.rows);
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}