const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'elsapp2024secretkey';

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), phone VARCHAR(50), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS warehouses (id SERIAL PRIMARY KEY, name VARCHAR(255), address TEXT, base_pay_20ft DECIMAL DEFAULT 0, base_pay_40ft DECIMAL DEFAULT 0, base_pay_45ft DECIMAL DEFAULT 0, base_pay_53ft DECIMAL DEFAULT 0, piece_bonus DECIMAL DEFAULT 0, sku_bonus DECIMAL DEFAULT 0, wait_time_pay DECIMAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shifts (id SERIAL PRIMARY KEY, warehouse_id INTEGER, shift_date DATE, start_time TIME, notes TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shift_assignments (id SERIAL PRIMARY KEY, shift_id INTEGER, employee_id INTEGER, status VARCHAR(50) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS containers (id SERIAL PRIMARY KEY, shift_id INTEGER, employee_id INTEGER, container_number VARCHAR(255), container_size VARCHAR(10) DEFAULT '40ft', checkin_time TIMESTAMP, checkout_time TIMESTAMP, start_time TIMESTAMP, end_time TIMESTAMP, wait_time INTEGER DEFAULT 0, total_pieces INTEGER DEFAULT 0, sku_count INTEGER DEFAULT 0, total_earning DECIMAL DEFAULT 0, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW());
  `);
}
setupDB();

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: result.rows[0].id, role: result.rows[0].role }, JWT_SECRET);
    const { password: _, ...user } = result.rows[0];
    res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/users', auth, async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (name, email, password, role, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *', [name, email, hash, 'employee', phone]);
    const { password: _, ...user } = result.rows[0];
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/users', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role, phone FROM users WHERE role = $1', ['employee']);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/warehouses', auth, async (req, res) => {
  try {
    const { name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay } = req.body;
    const result = await pool.query(
      'INSERT INTO warehouses (name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, address, base_pay_20ft||0, base_pay_40ft||0, base_pay_45ft||0, base_pay_53ft||0, piece_bonus||0, sku_bonus||0, wait_time_pay||0]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/warehouses', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM warehouses ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/shifts', auth, async (req, res) => {
  try {
    const { warehouse_id, shift_date, start_time, notes, employee_ids } = req.body;
    const shift = await pool.query('INSERT INTO shifts (warehouse_id, shift_date, start_time, notes) VALUES ($1,$2,$3,$4) RETURNING *', [warehouse_id, shift_date, start_time, notes]);
    if (employee_ids?.length) {
      for (const eid of employee_ids) {
        await pool.query('INSERT INTO shift_assignments (shift_id, employee_id) VALUES ($1,$2)', [shift.rows[0].id, eid]);
      }
    }
    res.json(shift.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT s.*, w.name as warehouse_name FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id = w.id ORDER BY s.shift_date DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/my-shifts', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT s.*, w.name as warehouse_name, sa.status as assignment_status FROM shifts s JOIN shift_assignments sa ON s.id = sa.shift_id LEFT JOIN warehouses w ON s.warehouse_id = w.id WHERE sa.employee_id = $1 ORDER BY s.shift_date DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/shift-assignments/:shift_id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE shift_assignments SET status = $1 WHERE shift_id = $2 AND employee_id = $3', [status, req.params.shift_id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/containers/checkin', auth, async (req, res) => {
  try {
    const { shift_id, container_number, container_size } = req.body;
    const result = await pool.query(
      'INSERT INTO containers (shift_id, employee_id, container_number, container_size, checkin_time, status) VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *',
      [shift_id, req.user.id, container_number, container_size || '40ft', 'checked_in']
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/start', auth, async (req, res) => {
  try {
    const { wait_time } = req.body;
    const result = await pool.query('UPDATE containers SET start_time=NOW(), wait_time=$1, status=$2 WHERE id=$3 RETURNING *', [wait_time, 'in_progress', req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/checkout', auth, async (req, res) => {
  try {
    const { total_pieces, sku_count } = req.body;
    const container = await pool.query('SELECT c.*, w.piece_bonus, w.sku_bonus, w.base_pay_20ft, w.base_pay_40ft, w.base_pay_45ft, w.base_pay_53ft, w.wait_time_pay FROM containers c JOIN shifts s ON c.shift_id = s.id JOIN warehouses w ON s.warehouse_id = w.id WHERE c.id = $1', [req.params.id]);
    const c = container.rows[0];
    const sizePayMap = { '20ft': c.base_pay_20ft, '40ft': c.base_pay_40ft, '45ft': c.base_pay_45ft, '53ft': c.base_pay_53ft };
    const basePay = parseFloat(sizePayMap[c.container_size] || c.base_pay_40ft || 0);
    const piecePay = parseFloat(c.piece_bonus || 0) * parseInt(total_pieces || 0);
    const skuPay = parseFloat(c.sku_bonus || 0) * parseInt(sku_count || 0);
    const waitPay = parseFloat(c.wait_time_pay || 0) * parseInt(c.wait_time || 0);
    const total = basePay + piecePay + skuPay + waitPay;
    const result = await pool.query('UPDATE containers SET checkout_time=NOW(), end_time=NOW(), total_pieces=$1, sku_count=$2, total_earning=$3, status=$4 WHERE id=$5 RETURNING *', [total_pieces, sku_count, total, 'completed', req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/earnings/weekly', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT SUM(total_earning) as total, COUNT(*) as containers FROM containers WHERE employee_id = $1 AND created_at >= NOW() - INTERVAL \'7 days\'', [req.user.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/containers', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT c.*, u.name as employee_name FROM containers c JOIN users u ON c.employee_id = u.id ORDER BY c.created_at DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.put('/warehouses/:id', auth, async (req, res) => {
  try {
    const { name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay } = req.body;
    const result = await pool.query(
      'UPDATE warehouses SET name=$1, address=$2, base_pay_20ft=$3, base_pay_40ft=$4, base_pay_45ft=$5, base_pay_53ft=$6, piece_bonus=$7, sku_bonus=$8, wait_time_pay=$9 WHERE id=$10 RETURNING *',
      [name, address, base_pay_20ft||0, base_pay_40ft||0, base_pay_45ft||0, base_pay_53ft||0, piece_bonus||0, sku_bonus||0, wait_time_pay||0, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/warehouses/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM warehouses WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/users/:id', auth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const result = await pool.query(
      'UPDATE users SET name=$1, email=$2, phone=$3 WHERE id=$4 RETURNING *',
      [name, email, phone, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/users/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/shifts/:id', auth, async (req, res) => {
  try {
    const { warehouse_id, shift_date, start_time, notes } = req.body;
    const result = await pool.query(
      'UPDATE shifts SET warehouse_id=$1, shift_date=$2, start_time=$3, notes=$4 WHERE id=$5 RETURNING *',
      [warehouse_id, shift_date, start_time, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/shifts/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shift_assignments WHERE shift_id=$1', [req.params.id]);
    await pool.query('DELETE FROM shifts WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
