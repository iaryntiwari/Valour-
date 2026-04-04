import pool from "../lib/db.js";

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { customer_name, customer_address, customer_contact, items } = req.body;
    
    if (!customer_name || !customer_address || !customer_contact || !items || !items.length) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    await client.query('BEGIN');
    
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
  } finally {
    client.release();
  }
}