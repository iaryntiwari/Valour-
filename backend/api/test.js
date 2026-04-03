import pool from "../lib/db.js";

export default async function handler(req, res) {

  try {
    const result = await pool.query("SELECT NOW()");

    res.status(200).json({success: true, time: result.rows[0].now, message: "API is working!"});
  } catch (e) {
    res.status(500).json({success: false, error: e.message });
  }
}

