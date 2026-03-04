const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// Setup database tables
async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(200) NOT NULL,
      role VARCHAR(10) DEFAULT 'employee',
      phone VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      address TEXT,
      base_pay DECIMAL(10,2) DEFAULT 0,
      piece_bonus DECIMAL(10,4) DEFAULT 0,
      sku_bonus DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER REFERENCES warehouses(id),
      shift_date DATE NOT NULL,
      start_time TIME NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shift_assignments (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER REFERENCES shifts(id),
      employee_id INTEGER REFERENCES users(id),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS containers (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER REFERENCES shifts(id),
      employee_id INTEGER REFERENCES users(id),
      container_number VARCHAR(50),
      checkin_time TIMESTAMP,
      checkout_time TIMESTAMP,
      start_time TIMESTAMP,
      end_time TIMESTAMP,
      wait_time INTEGER DEFAULT 0,
      total_pieces INTEGER DEFAULT 0,
      sku_count INTEGER DEFAULT 0,
      total_earning DECIMAL(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'checkedin',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database tables ready!');
}

// LOGIN
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows[0]) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(400).json({ error: 'Wrong password' });
    const token = jwt.sign({ id: result.rows[0].id, role: result.rows[0].role }, process.env.JWT_SECRET);
    res.json({ token, user: result.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CREATE EMPLOYEE (admin only)
app.post('/users', auth, async (req, res) => {
  const { name, email, password, phone } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name,email,password,phone,role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, email, hashed, phone, 'employee']
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET ALL EMPLOYEES
app.get('/users', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id,name,email,phone,role FROM users WHERE role=$1', ['employee']);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// WAREHOUSES
app.post('/warehouses', auth, async (req, res) => {
  const { name, address, base_pay, piece_bonus, sku_bonus } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO warehouses (name,address,base_pay,piece_bonus,sku_bonus) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, address, base_pay, piece_bonus, sku_bonus]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/warehouses', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM warehouses ORDER BY name');
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/warehouses/:id', auth, async (req, res) => {
  const { name, address, base_pay, piece_bonus, sku_bonus } = req.body;
  try {
    const result = await pool.query(
      'UPDATE warehouses SET name=$1,address=$2,base_pay=$3,piece_bonus=$4,sku_bonus=$5 WHERE id=$6 RETURNING *',
      [name, address, base_pay, piece_bonus, sku_bonus, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SHIFTS
app.post('/shifts', auth, async (req, res) => {
  const { warehouse_id, shift_date, start_time, employee_ids, notes } = req.body;
  try {
    const shift = await pool.query(
      'INSERT INTO shifts (warehouse_id,shift_date,start_time,notes) VALUES ($1,$2,$3,$4) RETURNING *',
      [warehouse_id, shift_date, start_time, notes]
    );
    for (const eid of employee_ids) {
      await pool.query('INSERT INTO shift_assignments (shift_id,employee_id) VALUES ($1,$2)', [shift.rows[0].id, eid]);
    }
    res.json(shift.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, w.name as warehouse_name, w.address,
        json_agg(json_build_object('id',u.id,'name',u.name,'status',sa.status)) as employees
      FROM shifts s
      JOIN warehouses w ON s.warehouse_id=w.id
      JOIN shift_assignments sa ON sa.shift_id=s.id
      JOIN users u ON sa.employee_id=u.id
      GROUP BY s.id, w.name, w.address
      ORDER BY s.shift_date DESC
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// EMPLOYEE: get my shifts
app.get('/my-shifts', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, w.name as warehouse_name, w.address, sa.status as my_status,
        json_agg(json_build_object('id',u.id,'name',u.name)) as coworkers
      FROM shifts s
      JOIN warehouses w ON s.warehouse_id=w.id
      JOIN shift_assignments sa ON sa.shift_id=s.id AND sa.employee_id=$1
      JOIN shift_assignments sa2 ON sa2.shift_id=s.id
      JOIN users u ON sa2.employee_id=u.id
      GROUP BY s.id, w.name, w.address, sa.status
      ORDER BY s.shift_date DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ACCEPT/DECLINE SHIFT
app.put('/shift-assignments/:shift_id', auth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE shift_assignments SET status=$1 WHERE shift_id=$2 AND employee_id=$3 RETURNING *',
      [status, req.params.shift_id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CHECK IN
app.post('/containers/checkin', auth, async (req, res) => {
  const { shift_id, container_number } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO containers (shift_id,employee_id,container_number,checkin_time,status) VALUES ($1,$2,$3,NOW(),$4) RETURNING *',
      [shift_id, req.user.id, container_number, 'checkedin']
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// START WORK
app.put('/containers/:id/start', auth, async (req, res) => {
  const { wait_time } = req.body;
  try {
    const result = await pool.query(
      'UPDATE containers SET start_time=NOW(), wait_time=$1, status=$2 WHERE id=$3 RETURNING *',
      [wait_time, 'working', req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CHECK OUT
app.put('/containers/:id/checkout', auth, async (req, res) => {
  const { total_pieces, sku_count } = req.body;
  try {
    const container = await pool.query('SELECT c.*, w.base_pay, w.piece_bonus, w.sku_bonus FROM containers c JOIN shifts s ON c.shift_id=s.id JOIN warehouses w ON s.warehouse_id=w.id WHERE c.id=$1', [req.params.id]);
    const c = container.rows[0];
    const earning = parseFloat(c.base_pay) + (total_pieces * parseFloat(c.piece_bonus)) + (sku_count * parseFloat(c.sku_bonus));
    const result = await pool.query(
      'UPDATE containers SET checkout_time=NOW(), end_time=NOW(), total_pieces=$1, sku_count=$2, total_earning=$3, status=$4 WHERE id=$5 RETURNING *',
      [total_pieces, sku_count, earning, 'completed', req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// WEEKLY EARNINGS
app.get('/earnings/weekly', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(SUM(total_earning),0) as weekly_total,
        json_agg(json_build_object('id',id,'container_number',container_number,'total_earning',total_earning,'checkout_time',checkout_time,'total_pieces',total_pieces)) as containers
      FROM containers
      WHERE employee_id=$1 AND status='completed'
      AND checkout_time >= date_trunc('week', NOW())
    `, [req.user.id]);
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ADMIN: all containers today
app.get('/admin/containers', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.name as employee_name, w.name as warehouse_name
      FROM containers c
      JOIN users u ON c.employee_id=u.id
      JOIN shifts s ON c.shift_id=s.id
      JOIN warehouses w ON s.warehouse_id=w.id
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

setupDB().then(() => {
  app.listen(process.env.PORT, () => console.log(`ELS Backend running on port ${process.env.PORT}`));
});
