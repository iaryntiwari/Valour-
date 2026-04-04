import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const designers = await client.query(`SELECT * FROM designers ORDER BY designer_id`);
      res.status(200).json(designers.rows);
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}