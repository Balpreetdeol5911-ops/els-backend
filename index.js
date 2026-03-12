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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), phone VARCHAR(50), sin_number VARCHAR(255), bank_account VARCHAR(255), bank_transit VARCHAR(255), bank_institution VARCHAR(255), address VARCHAR(255), city VARCHAR(255), province VARCHAR(50), postal_code VARCHAR(20), created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS warehouses (id SERIAL PRIMARY KEY, name VARCHAR(255), address TEXT, base_pay_20ft DECIMAL DEFAULT 0, base_pay_40ft DECIMAL DEFAULT 0, base_pay_45ft DECIMAL DEFAULT 0, base_pay_53ft DECIMAL DEFAULT 0, piece_bonus DECIMAL DEFAULT 0, sku_bonus DECIMAL DEFAULT 0, wait_time_pay DECIMAL DEFAULT 0, piece_bonus_min INTEGER DEFAULT 0, sku_bonus_min INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS shifts (id SERIAL PRIMARY KEY, warehouse_id INTEGER, shift_date DATE, start_time TIME, notes TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS shift_assignments (id SERIAL PRIMARY KEY, shift_id INTEGER, employee_id INTEGER, status VARCHAR(50) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS containers (id SERIAL PRIMARY KEY, shift_id INTEGER, employee_id INTEGER, container_number VARCHAR(255), container_size VARCHAR(10) DEFAULT '40ft', checkin_time TIMESTAMP, checkout_time TIMESTAMP, start_time TIMESTAMP, end_time TIMESTAMP, wait_time INTEGER DEFAULT 0, total_pieces INTEGER DEFAULT 0, sku_count INTEGER DEFAULT 0, total_earning DECIMAL DEFAULT 0, total_before_split DECIMAL(10,2) DEFAULT 0, payment_status VARCHAR(50) DEFAULT 'unpaid', payroll_id INTEGER, worker_count INTEGER DEFAULT 1, co_worker_ids INTEGER[], actual_start_time VARCHAR(20), actual_end_time VARCHAR(20), hours_worked DECIMAL(5,2), status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS payroll_records (id SERIAL PRIMARY KEY, employee_id INTEGER, week_start DATE, week_end DATE, total_amount DECIMAL DEFAULT 0, payment_method VARCHAR(50) DEFAULT 'direct_deposit', notes TEXT, paid_at TIMESTAMP DEFAULT NOW());
    `);
    console.log('DB tables ready');
  } catch (e) { console.log('DB setup error:', e.message); }
}

async function migrateDB() {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS sin_number VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_transit VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_institution VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(255)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS province VARCHAR(50)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)');
    await pool.query('ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS piece_bonus_min INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS sku_bonus_min INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT \'unpaid\'');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS payroll_id INTEGER');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS worker_count INTEGER DEFAULT 1');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS co_worker_ids INTEGER[]');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS total_before_split DECIMAL(10,2)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS actual_start_time VARCHAR(20)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS actual_end_time VARCHAR(20)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(5,2)');
    console.log('DB migration complete');
  } catch (e) { console.log('Migration error:', e.message); }
}

setupDB().then(() => migrateDB());

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
    const result = await pool.query('INSERT INTO users (name, email, password, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, email, hash, 'employee', phone]);
    const { password: _, ...user } = result.rows[0];
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/users', auth, async (req, res) => {
  try { res.json((await pool.query("SELECT id,name,email,role,phone FROM users WHERE role='employee'")).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/users/:id', auth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    res.json((await pool.query('UPDATE users SET name=$1,email=$2,phone=$3 WHERE id=$4 RETURNING *', [name, email, phone, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/users/:id', auth, async (req, res) => {
  try { await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/users/:id/banking', auth, async (req, res) => {
  try {
    const { sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code } = req.body;
    res.json((await pool.query('UPDATE users SET sin_number=$1,bank_account=$2,bank_transit=$3,bank_institution=$4,address=$5,city=$6,province=$7,postal_code=$8 WHERE id=$9 RETURNING *', [sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/employees', auth, async (req, res) => {
  try { res.json((await pool.query("SELECT id,name,email,role,phone,sin_number,bank_account,bank_transit,bank_institution,address,city,province,postal_code FROM users WHERE role='employee' ORDER BY name")).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/employees', auth, async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    res.json((await pool.query('INSERT INTO users (name,email,password,role,phone) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,phone', [name, email, hashed, 'employee', phone])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/employees/:id', auth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    res.json((await pool.query('UPDATE users SET name=$1,email=$2,phone=$3 WHERE id=$4 RETURNING id,name,email,role,phone', [name, email, phone, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/employees/:id/banking', auth, async (req, res) => {
  try {
    const { sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code } = req.body;
    res.json((await pool.query('UPDATE users SET sin_number=$1,bank_account=$2,bank_transit=$3,bank_institution=$4,address=$5,city=$6,province=$7,postal_code=$8 WHERE id=$9 RETURNING *', [sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/employees/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM containers WHERE employee_id=$1', [req.params.id]);
    await pool.query('DELETE FROM shift_assignments WHERE employee_id=$1', [req.params.id]);
    await pool.query('DELETE FROM payroll_records WHERE employee_id=$1', [req.params.id]);
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/warehouses', auth, async (req, res) => {
  try {
    const { name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay, piece_bonus_min, sku_bonus_min } = req.body;
    res.json((await pool.query('INSERT INTO warehouses (name,address,base_pay_20ft,base_pay_40ft,base_pay_45ft,base_pay_53ft,piece_bonus,sku_bonus,wait_time_pay,piece_bonus_min,sku_bonus_min) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [name, address, base_pay_20ft||0, base_pay_40ft||0, base_pay_45ft||0, base_pay_53ft||0, piece_bonus||0, sku_bonus||0, wait_time_pay||0, piece_bonus_min||0, sku_bonus_min||0])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/warehouses', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM warehouses ORDER BY created_at DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/warehouses/:id', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM warehouses WHERE id=$1', [req.params.id])).rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/warehouses/:id', auth, async (req, res) => {
  try {
    const { name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay, piece_bonus_min, sku_bonus_min } = req.body;
    res.json((await pool.query('UPDATE warehouses SET name=$1,address=$2,base_pay_20ft=$3,base_pay_40ft=$4,base_pay_45ft=$5,base_pay_53ft=$6,piece_bonus=$7,sku_bonus=$8,wait_time_pay=$9,piece_bonus_min=$10,sku_bonus_min=$11 WHERE id=$12 RETURNING *', [name, address, base_pay_20ft||0, base_pay_40ft||0, base_pay_45ft||0, base_pay_53ft||0, piece_bonus||0, sku_bonus||0, wait_time_pay||0, piece_bonus_min||0, sku_bonus_min||0, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/warehouses/:id', auth, async (req, res) => {
  try { await pool.query('DELETE FROM warehouses WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/shifts', auth, async (req, res) => {
  try {
    const { warehouse_id, shift_date, start_time, notes, employee_ids } = req.body;
    const shift = await pool.query('INSERT INTO shifts (warehouse_id,shift_date,start_time,notes) VALUES ($1,$2,$3,$4) RETURNING *', [warehouse_id, shift_date, start_time, notes]);
    if (employee_ids?.length) { for (const eid of employee_ids) { await pool.query('INSERT INTO shift_assignments (shift_id,employee_id) VALUES ($1,$2)', [shift.rows[0].id, eid]); } }
    res.json(shift.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT s.*,w.name as warehouse_name,w.address as warehouse_address FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id=w.id ORDER BY s.shift_date DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/completed', auth, async (req, res) => {
  try {
    res.json((await pool.query("SELECT s.*,w.name as warehouse_name,w.address as warehouse_address,COUNT(c.id)::text as total_containers,COUNT(CASE WHEN c.status='completed' THEN 1 END)::text as completed_containers FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id=w.id LEFT JOIN containers c ON c.shift_id=s.id GROUP BY s.id,w.name,w.address HAVING COUNT(c.id)>0 AND COUNT(c.id)=COUNT(CASE WHEN c.status='completed' THEN 1 END) ORDER BY s.shift_date DESC LIMIT 30")).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/details', auth, async (req, res) => {
  try {
    const shift = await pool.query('SELECT s.*,w.name as warehouse_name,w.address as warehouse_address FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id=w.id WHERE s.id=$1', [req.params.id]);
    const employees = await pool.query('SELECT u.id,u.name,u.email,u.phone,sa.status FROM shift_assignments sa JOIN users u ON sa.employee_id=u.id WHERE sa.shift_id=$1', [req.params.id]);
    const containers = await pool.query('SELECT c.*,u.name as employee_name FROM containers c LEFT JOIN users u ON c.employee_id=u.id WHERE c.shift_id=$1 ORDER BY c.created_at ASC', [req.params.id]);
    res.json({ shift: shift.rows[0], employees: employees.rows, containers: containers.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/shifts/:id', auth, async (req, res) => {
  try {
    const { warehouse_id, shift_date, start_time, notes } = req.body;
    res.json((await pool.query('UPDATE shifts SET warehouse_id=$1,shift_date=$2,start_time=$3,notes=$4 WHERE id=$5 RETURNING *', [warehouse_id, shift_date, start_time, notes, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/shifts/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM containers WHERE shift_id=$1', [req.params.id]);
    await pool.query('DELETE FROM shift_assignments WHERE shift_id=$1', [req.params.id]);
    await pool.query('DELETE FROM shifts WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/shifts/:id/force', auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM containers WHERE shift_id=$1 AND status='planned'", [req.params.id]);
    await pool.query('DELETE FROM shift_assignments WHERE shift_id=$1', [req.params.id]);
    await pool.query('DELETE FROM shifts WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/my-shifts', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT s.*,w.name as warehouse_name,sa.status as assignment_status FROM shifts s JOIN shift_assignments sa ON s.id=sa.shift_id LEFT JOIN warehouses w ON s.warehouse_id=w.id WHERE sa.employee_id=$1 ORDER BY s.shift_date DESC', [req.user.id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/my-active-shifts-v2', auth, async (req, res) => {
  try {
    res.json((await pool.query("SELECT s.*,w.name as warehouse_name,w.address as warehouse_address,sa.status as assignment_status,COUNT(c.id)::text as total_containers,COUNT(CASE WHEN c.status='completed' THEN 1 END)::text as completed_containers,COUNT(sa2.id)::text as employee_count FROM shifts s JOIN shift_assignments sa ON sa.shift_id=s.id AND sa.employee_id=$1 JOIN warehouses w ON s.warehouse_id=w.id LEFT JOIN containers c ON c.shift_id=s.id LEFT JOIN shift_assignments sa2 ON sa2.shift_id=s.id WHERE sa.status!='rejected' GROUP BY s.id,w.name,w.address,sa.status HAVING COUNT(c.id)=0 OR COUNT(CASE WHEN c.status!='completed' THEN 1 END)>0 ORDER BY s.shift_date DESC", [req.user.id])).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/shift-assignments/:shift_id', auth, async (req, res) => {
  try { await pool.query('UPDATE shift_assignments SET status=$1 WHERE shift_id=$2 AND employee_id=$3', [req.body.status, req.params.shift_id, req.user.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/shift-assignments/:shift_id/respond', auth, async (req, res) => {
  try { res.json((await pool.query('UPDATE shift_assignments SET status=$1 WHERE shift_id=$2 AND employee_id=$3 RETURNING *', [req.body.status, req.params.shift_id, req.user.id])).rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/shifts/:id/containers', auth, async (req, res) => {
  try {
    const inserted = [];
    for (const c of req.body.containers) { inserted.push((await pool.query('INSERT INTO containers (shift_id,container_number,container_size,status) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.id, c.container_number, c.container_size, 'planned'])).rows[0]); }
    res.json(inserted);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/containers', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT c.*,u.name as employee_name FROM containers c LEFT JOIN users u ON c.employee_id=u.id WHERE c.shift_id=$1 ORDER BY c.created_at ASC', [req.params.id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/containers/v2', auth, async (req, res) => {
  try {
    res.json((await pool.query("SELECT c.*,u.name as employee_name FROM containers c LEFT JOIN users u ON c.employee_id=u.id WHERE c.shift_id=$1 AND (c.status='planned' OR c.employee_id=$2 OR (c.co_worker_ids IS NOT NULL AND $2=ANY(c.co_worker_ids)) OR (c.status!='completed' AND c.employee_id IS NOT NULL)) ORDER BY c.created_at ASC", [req.params.id, req.user.id])).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/shifts/:id/containers', auth, async (req, res) => {
  try { await pool.query("DELETE FROM containers WHERE shift_id=$1 AND status='planned'", [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/containers', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT c.*,u.name as employee_name FROM containers c LEFT JOIN users u ON c.employee_id=u.id ORDER BY c.created_at DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/containers/checkin', auth, async (req, res) => {
  try {
    const { shift_id, container_number, container_size } = req.body;
    res.json((await pool.query("INSERT INTO containers (shift_id,employee_id,container_number,container_size,checkin_time,status) VALUES ($1,$2,$3,$4,NOW(),'checked_in') RETURNING *", [shift_id, req.user.id, container_number, container_size||'40ft'])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/containers/checkin/v2', auth, async (req, res) => {
  try {
    const { shift_id, container_number, container_size } = req.body;
    const existing = await pool.query("SELECT * FROM containers WHERE shift_id=$1 AND container_size=$2 AND status='planned' AND employee_id IS NULL LIMIT 1", [shift_id, container_size]);
    if (existing.rows.length===0) return res.status(400).json({ error: 'No available container of this size' });
    res.json((await pool.query("UPDATE containers SET employee_id=$1,container_number=$2,status='checked_in',checkin_time=NOW() WHERE id=$3 RETURNING *", [req.user.id, container_number, existing.rows[0].id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/start', auth, async (req, res) => {
  try { res.json((await pool.query("UPDATE containers SET start_time=NOW(),wait_time=$1,status='in_progress' WHERE id=$2 RETURNING *", [req.body.wait_time||0, req.params.id])).rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/containers/:id/join', auth, async (req, res) => {
  try {
    const c = (await pool.query('SELECT * FROM containers WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Container not found' });
    if (c.status==='completed') return res.status(400).json({ error: 'Already completed' });
    const coWorkers = c.co_worker_ids||[];
    if (coWorkers.includes(req.user.id)) return res.status(400).json({ error: 'Already joined' });
    coWorkers.push(req.user.id);
    res.json((await pool.query('UPDATE containers SET worker_count=$1,co_worker_ids=$2 WHERE id=$3 RETURNING *', [(c.worker_count||1)+1, coWorkers, req.params.id])).rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/containers/:id/workers', auth, async (req, res) => {
  try {
    const c = (await pool.query('SELECT * FROM containers WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    const ids = [c.employee_id, ...(c.co_worker_ids||[])].filter(Boolean);
    res.json((await pool.query('SELECT id,name FROM users WHERE id=ANY($1)', [ids])).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/checkout', auth, async (req, res) => {
  try {
    const { total_pieces, sku_count } = req.body;
    const c = (await pool.query('SELECT c.*,w.piece_bonus,w.sku_bonus,w.base_pay_20ft,w.base_pay_40ft,w.base_pay_45ft,w.base_pay_53ft,w.wait_time_pay FROM containers c JOIN shifts s ON c.shift_id=s.id JOIN warehouses w ON s.warehouse_id=w.id WHERE c.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Container not found' });
    const sizeMap = {'20ft':c.base_pay_20ft,'40ft':c.base_pay_40ft,'45ft':c.base_pay_45ft,'53ft':c.base_pay_53ft};
    const total = (parseFloat(sizeMap[c.container_size]||c.base_pay_40ft||0)) + (parseFloat(c.piece_bonus||0)*parseInt(total_pieces||0)) + (parseFloat(c.sku_bonus||0)*parseInt(sku_count||0)) + (parseFloat(c.wait_time_pay||0)*parseInt(c.wait_time||0));
    res.json((await pool.query("UPDATE containers SET checkout_time=NOW(),end_time=NOW(),total_pieces=$1,sku_count=$2,total_earning=$3,status='completed',payment_status='unpaid' WHERE id=$4 RETURNING *", [total_pieces, sku_count, total.toFixed(2), req.params.id])).rows[0]);
  } catch (e) { console.log('V1 CHECKOUT ERROR:', e.message); res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/checkout/v2', auth, async (req, res) => {
  try {
    const { total_pieces, sku_count, actual_start_time, actual_end_time } = req.body;
    const containerId = req.params.id;
    const container = (await pool.query('SELECT * FROM containers WHERE id=$1', [containerId])).rows[0];
    if (!container) return res.status(404).json({ error: 'Container not found' });
    const shift = (await pool.query('SELECT s.*,w.base_pay_20ft,w.base_pay_40ft,w.base_pay_45ft,w.base_pay_53ft,w.piece_bonus,w.sku_bonus,w.wait_time_pay,w.piece_bonus_min,w.sku_bonus_min FROM shifts s JOIN warehouses w ON s.warehouse_id=w.id WHERE s.id=$1', [container.shift_id])).rows[0];
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const size = container.container_size;
    let basePay = 0;
    if (size==='20ft') basePay=parseFloat(shift.base_pay_20ft)||0;
    else if (size==='40ft') basePay=parseFloat(shift.base_pay_40ft)||0;
    else if (size==='45ft') basePay=parseFloat(shift.base_pay_45ft)||0;
    else if (size==='53ft') basePay=parseFloat(shift.base_pay_53ft)||0;
    const pieceBonusMin=parseInt(shift.piece_bonus_min)||0;
    const skuBonusMin=parseInt(shift.sku_bonus_min)||0;
    const pieceBonus=(parseInt(total_pieces||0)>pieceBonusMin)?(parseFloat(shift.piece_bonus)||0):0;
    const skuBonus=(parseInt(sku_count||0)>skuBonusMin)?(parseFloat(shift.sku_bonus)||0):0;
    const waitTimePay=(container.wait_time>0)?((parseFloat(shift.wait_time_pay)||0)*container.wait_time/60):0;
    const totalBeforeSplit=basePay+pieceBonus+skuBonus+waitTimePay;
    const workerCount=container.worker_count||1;
    const totalPerWorker=totalBeforeSplit/workerCount;
    let hoursWorked=null;
    if (actual_start_time && actual_end_time) {
      const s=new Date('1970-01-01T'+actual_start_time);
      const e=new Date('1970-01-01T'+actual_end_time);
      hoursWorked=(e-s)/(1000*60*60);
      if (hoursWorked<0) hoursWorked+=24;
    }
    await pool.query('UPDATE containers SET status=$1,checkout_time=NOW(),total_pieces=$2,sku_count=$3,total_earning=$4,total_before_split=$5,payment_status=$6,actual_start_time=$7,actual_end_time=$8,hours_worked=$9 WHERE id=$10', ['completed', total_pieces||0, sku_count||0, totalPerWorker.toFixed(2), totalBeforeSplit.toFixed(2), 'unpaid', actual_start_time||null, actual_end_time||null, hoursWorked, containerId]);
    if (container.co_worker_ids && container.co_worker_ids.length>0) {
      for (const cid of container.co_worker_ids) {
        await pool.query('UPDATE containers SET total_earning=$1,total_before_split=$2,payment_status=$3,actual_start_time=$4,actual_end_time=$5,hours_worked=$6 WHERE shift_id=$7 AND employee_id=$8 AND container_number=$9 AND id!=$10', [totalPerWorker.toFixed(2), totalBeforeSplit.toFixed(2), 'unpaid', actual_start_time||null, actual_end_time||null, hoursWorked, container.shift_id, cid, container.container_number, containerId]);
      }
    }
    res.json((await pool.query('SELECT * FROM containers WHERE id=$1', [containerId])).rows[0]);
  } catch (e) { console.log('V2 CHECKOUT ERROR:', e.message, e.stack); res.status(500).json({ error: e.message }); }
});

app.get('/earnings/weekly', auth, async (req, res) => {
  try { res.json((await pool.query("SELECT COALESCE(SUM(total_earning::numeric),0) as total,COUNT(*) as containers FROM containers WHERE employee_id=$1 AND created_at>=NOW()-INTERVAL '7 days' AND status='completed'", [req.user.id])).rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/earnings/detail/:employee_id', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT c.*,s.shift_date,w.name as warehouse_name FROM containers c LEFT JOIN shifts s ON c.shift_id=s.id LEFT JOIN warehouses w ON s.warehouse_id=w.id WHERE c.employee_id=$1 ORDER BY c.created_at DESC', [req.params.employee_id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/payroll/weekly', auth, async (req, res) => {
  try {
    res.json((await pool.query("SELECT u.id,u.name,u.email,u.phone,u.sin_number,u.bank_account,u.bank_transit,u.bank_institution,u.address,u.city,u.province,u.postal_code,COUNT(c.id)::text as container_count,COALESCE(SUM(CASE WHEN c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END),0)::text as total_earned,COALESCE(SUM(CASE WHEN (c.payment_status IS NULL OR c.payment_status!='paid') AND c.status='completed' AND c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END),0)::text as total_unpaid FROM users u LEFT JOIN containers c ON c.employee_id=u.id AND c.created_at>=NOW()-INTERVAL '7 days' WHERE u.role='employee' GROUP BY u.id,u.name,u.email,u.phone,u.sin_number,u.bank_account,u.bank_transit,u.bank_institution,u.address,u.city,u.province,u.postal_code")).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/payroll/weekly', auth, async (req, res) => {
  try {
    res.json((await pool.query("SELECT u.id,u.name,u.email,u.phone,u.sin_number,u.bank_account,u.bank_transit,u.bank_institution,u.address,u.city,u.province,u.postal_code,COUNT(c.id)::text as container_count,COALESCE(SUM(CASE WHEN c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END),0)::text as total_earned,COALESCE(SUM(CASE WHEN (c.payment_status IS NULL OR c.payment_status!='paid') AND c.status='completed' AND c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END),0)::text as total_unpaid FROM users u LEFT JOIN containers c ON c.employee_id=u.id AND c.created_at>=NOW()-INTERVAL '7 days' WHERE u.role='employee' GROUP BY u.id,u.name,u.email,u.phone,u.sin_number,u.bank_account,u.bank_transit,u.bank_institution,u.address,u.city,u.province,u.postal_code")).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/payroll/mark-paid', auth, async (req, res) => {
  try {
    const { employee_id, week_start, week_end, total_amount, payment_method, notes } = req.body;
    const r = await pool.query('INSERT INTO payroll_records (employee_id,week_start,week_end,total_amount,payment_method,notes,paid_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *', [employee_id, week_start, week_end, total_amount, payment_method||'direct_deposit', notes||'']);
    await pool.query("UPDATE containers SET payment_status='paid',payroll_id=$1 WHERE employee_id=$2 AND created_at>=$3::date AND created_at<($4::date+interval '1 day') AND status='completed' AND (payment_status IS NULL OR payment_status!='paid')", [r.rows[0].id, employee_id, week_start, week_end]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/payroll/mark-paid', auth, async (req, res) => {
  try {
    const { employee_id, week_start, week_end, total_amount, payment_method, notes } = req.body;
    const r = await pool.query('INSERT INTO payroll_records (employee_id,week_start,week_end,total_amount,payment_method,notes,paid_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *', [employee_id, week_start, week_end, total_amount, payment_method||'direct_deposit', notes||'']);
    await pool.query("UPDATE containers SET payment_status='paid',payroll_id=$1 WHERE employee_id=$2 AND created_at>=$3::date AND created_at<($4::date+interval '1 day') AND status='completed' AND (payment_status IS NULL OR payment_status!='paid')", [r.rows[0].id, employee_id, week_start, week_end]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/payroll/history/:employee_id', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM payroll_records WHERE employee_id=$1 ORDER BY paid_at DESC', [req.params.employee_id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/payroll/history/:employee_id', auth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM payroll_records WHERE employee_id=$1 ORDER BY paid_at DESC', [req.params.employee_id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/dashboard', auth, async (req, res) => {
  try {
    const ac = await pool.query("SELECT c.*,u.name as employee_name,w.name as warehouse_name FROM containers c LEFT JOIN users u ON c.employee_id=u.id LEFT JOIN shifts s ON c.shift_id=s.id LEFT JOIN warehouses w ON s.warehouse_id=w.id WHERE c.status IN ('checked_in','in_progress') ORDER BY c.checkin_time DESC");
    const ws = await pool.query("SELECT COUNT(DISTINCT c.employee_id)::text as employees_worked,COUNT(c.id)::text as containers_completed,COALESCE(SUM(CASE WHEN c.status='completed' THEN c.total_earning::numeric ELSE 0 END),0)::text as total_earned,COALESCE(SUM(CASE WHEN c.status='completed' AND (c.payment_status IS NULL OR c.payment_status!='paid') THEN c.total_earning::numeric ELSE 0 END),0)::text as total_unpaid FROM containers c WHERE c.created_at>=NOW()-INTERVAL '7 days'");
    const ts = await pool.query("SELECT s.*,w.name as warehouse_name,w.address as warehouse_address,COUNT(sa.id)::text as employee_count FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id=w.id LEFT JOIN shift_assignments sa ON sa.shift_id=s.id WHERE DATE(s.shift_date)=CURRENT_DATE GROUP BY s.id,w.name,w.address ORDER BY s.start_time ASC");
    const te = await pool.query("SELECT u.name,u.id,COALESCE(SUM(c.total_earning::numeric),0)::text as total_earned,COUNT(c.id)::text as containers_done FROM users u LEFT JOIN containers c ON c.employee_id=u.id AND c.created_at>=NOW()-INTERVAL '7 days' AND c.status='completed' WHERE u.role='employee' GROUP BY u.id,u.name ORDER BY total_earned DESC LIMIT 5");
    res.json({ active_containers: ac.rows, weekly_stats: ws.rows[0], today_shifts: ts.rows, top_earners: te.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/migrate-columns', async (req, res) => {
  try {
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS total_before_split DECIMAL(10,2)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS actual_start_time VARCHAR(20)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS actual_end_time VARCHAR(20)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(5,2)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50)');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS worker_count INTEGER DEFAULT 1');
    await pool.query('ALTER TABLE containers ADD COLUMN IF NOT EXISTS co_worker_ids INTEGER[]');
    await pool.query('ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS piece_bonus_min INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS sku_bonus_min INTEGER DEFAULT 0');
    res.json({ success: true, message: 'Columns added!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
