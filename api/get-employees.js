import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const employees = await client.query(
       `SELECT e.*, b.branch_name FROM employees e
       JOIN branches b ON e.branch_id = b.branch_id ORDER BY e.emp_id`
      );
      res.status(200).json(employees.rows );
      return;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}