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
    const { name, address, base_pay_20ft, base_pay_40ft, base_pay_45ft, base_pay_53ft, piece_bonus, sku_bonus, wait_time_pay, piece_bonus_min, sku_bonus_min } = req.body;
    const result = await pool.query(
      'UPDATE warehouses SET name=$1, address=$2, base_pay_20ft=$3, base_pay_40ft=$4, base_pay_45ft=$5, base_pay_53ft=$6, piece_bonus=$7, sku_bonus=$8, wait_time_pay=$9, piece_bonus_min=$10, sku_bonus_min=$11 WHERE id=$12 RETURNING *',
      [name, address, base_pay_20ft||0, base_pay_40ft||0, base_pay_45ft||0, base_pay_53ft||0, piece_bonus||0, sku_bonus||0, wait_time_pay||0, piece_bonus_min||0, sku_bonus_min||0, req.params.id]
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

app.post('/shifts/:id/containers', auth, async (req, res) => {
  try {
    const { containers } = req.body;
    const shiftId = req.params.id;
    const inserted = [];
    for (const c of containers) {
      const result = await pool.query(
        'INSERT INTO containers (shift_id, container_number, container_size, status) VALUES ($1, $2, $3, $4) RETURNING *',
        [shiftId, c.container_number, c.container_size, 'planned']
      );
      inserted.push(result.rows[0]);
    }
    res.json(inserted);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/containers', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name as employee_name FROM containers c 
       LEFT JOIN users u ON c.employee_id = u.id 
       WHERE c.shift_id = $1 
       AND NOT (c.status = 'completed' AND c.employee_id != ${req.user.id} AND NOT (c.co_worker_ids @> ARRAY[${req.user.id}]::integer[]))
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/shifts/:id/containers', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM containers WHERE shift_id = $1 AND status = $2', [req.params.id, 'planned']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/details', auth, async (req, res) => {
  try {
    const shift = await pool.query(
      'SELECT s.*, w.name as warehouse_name FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id = w.id WHERE s.id = $1',
      [req.params.id]
    );
    const employees = await pool.query(
      'SELECT u.id, u.name, u.email, u.phone, sa.status FROM shift_assignments sa JOIN users u ON sa.employee_id = u.id WHERE sa.shift_id = $1',
      [req.params.id]
    );
    const containers = await pool.query(
      'SELECT c.*, u.name as employee_name FROM containers c LEFT JOIN users u ON c.employee_id = u.id WHERE c.shift_id = $1 ORDER BY c.created_at ASC',
      [req.params.id]
    );
    res.json({
      shift: shift.rows[0],
      employees: employees.rows,
      containers: containers.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/users/:id/banking', auth, async (req, res) => {
  try {
    const { sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code } = req.body;
    const result = await pool.query(
      `UPDATE users SET 
        sin_number=$1, bank_account=$2, bank_transit=$3, 
        bank_institution=$4, address=$5, city=$6, 
        province=$7, postal_code=$8 
       WHERE id=$9 RETURNING *`,
      [sin_number, bank_account, bank_transit, bank_institution, address, city, province, postal_code, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/payroll/mark-paid', auth, async (req, res) => {
  try {
    const { employee_id, week_start, week_end, total_amount, payment_method, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO payroll_records (employee_id, week_start, week_end, total_amount, payment_method, notes, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [employee_id, week_start, week_end, total_amount, payment_method || 'direct_deposit', notes || '']
    );
    await pool.query(
      `UPDATE containers SET payment_status='paid', payroll_id=$1 
       WHERE employee_id=$2 AND created_at >= $3 AND created_at <= $4 AND status='completed'`,
      [result.rows[0].id, employee_id, week_start, week_end]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/payroll/weekly', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.phone,
        u.sin_number, u.bank_account, u.bank_transit, 
        u.bank_institution, u.address, u.city, u.province, u.postal_code,
        COUNT(c.id) as container_count,
        SUM(CASE WHEN c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END) as total_earned,
        SUM(CASE WHEN c.payment_status = 'paid' AND c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END) as total_paid,
        SUM(CASE WHEN (c.payment_status IS NULL OR c.payment_status != 'paid') AND c.status='completed' AND c.total_earning IS NOT NULL THEN c.total_earning::numeric ELSE 0 END) as total_unpaid
       FROM users u
       LEFT JOIN containers c ON c.employee_id = u.id 
         AND c.created_at >= NOW() - INTERVAL '7 days'
       WHERE u.role = 'employee'
       GROUP BY u.id, u.name, u.email, u.phone, u.sin_number, 
                u.bank_account, u.bank_transit, u.bank_institution, 
                u.address, u.city, u.province, u.postal_code`
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/payroll/history/:employee_id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM payroll_records WHERE employee_id=$1 ORDER BY paid_at DESC`,
      [req.params.employee_id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/earnings/detail/:employee_id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, s.shift_date, w.name as warehouse_name 
       FROM containers c
       LEFT JOIN shifts s ON c.shift_id = s.id
       LEFT JOIN warehouses w ON s.warehouse_id = w.id
       WHERE c.employee_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.employee_id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function updateDBSchema() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sin_number VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_transit VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_institution VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS province VARCHAR(50)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)`);
    await pool.query(`ALTER TABLE containers ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'unpaid'`);
    await pool.query(`ALTER TABLE containers ADD COLUMN IF NOT EXISTS payroll_id INTEGER`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER,
        week_start DATE,
        week_end DATE,
        total_amount DECIMAL DEFAULT 0,
        payment_method VARCHAR(50) DEFAULT 'direct_deposit',
        notes TEXT,
        paid_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('DB schema updated');
  } catch (e) { console.log('Schema update error:', e.message); }
}
updateDBSchema();

app.put('/shift-assignments/:shift_id/respond', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE shift_assignments SET status=$1 WHERE shift_id=$2 AND employee_id=$3 RETURNING *',
      [status, req.params.shift_id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function updateWarehouseThresholds() {
  try {
    await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS piece_bonus_min INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS sku_bonus_min INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE containers ADD COLUMN IF NOT EXISTS worker_count INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE containers ADD COLUMN IF NOT EXISTS co_worker_ids INTEGER[]`);
    console.log('Warehouse thresholds schema updated');
  } catch (e) { console.log('Schema error:', e.message); }
}
updateWarehouseThresholds();

app.post('/containers/:id/join', auth, async (req, res) => {
  try {
    const container = await pool.query('SELECT * FROM containers WHERE id=$1', [req.params.id]);
    if (!container.rows[0]) return res.status(404).json({ error: 'Container not found' });
    if (container.rows[0].status === 'completed') return res.status(400).json({ error: 'Container already completed' });
    const currentWorkers = container.rows[0].worker_count || 1;
    const coWorkers = container.rows[0].co_worker_ids || [];
    if (coWorkers.includes(req.user.id)) return res.status(400).json({ error: 'Already joined' });
    coWorkers.push(req.user.id);
    const result = await pool.query(
      'UPDATE containers SET worker_count=$1, co_worker_ids=$2 WHERE id=$3 RETURNING *',
      [currentWorkers + 1, coWorkers, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/containers/:id/workers', auth, async (req, res) => {
  try {
    const container = await pool.query('SELECT * FROM containers WHERE id=$1', [req.params.id]);
    if (!container.rows[0]) return res.status(404).json({ error: 'Not found' });
    const workerIds = [container.rows[0].employee_id, ...(container.rows[0].co_worker_ids || [])].filter(Boolean);
    const workers = await pool.query('SELECT id, name FROM users WHERE id = ANY($1)', [workerIds]);
    res.json(workers.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/containers/:id/checkout/v2', auth, async (req, res) => {
  try {
    const { total_pieces, sku_count } = req.body;
    const container = await pool.query(
      `SELECT c.*, w.base_pay_20ft, w.base_pay_40ft, w.base_pay_45ft, w.base_pay_53ft,
              w.piece_bonus, w.sku_bonus, w.wait_time_pay,
              w.piece_bonus_min, w.sku_bonus_min
       FROM containers c
       JOIN shifts s ON c.shift_id = s.id
       JOIN warehouses w ON s.warehouse_id = w.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    const c = container.rows[0];
    const sizePayMap = {
      '20ft': parseFloat(c.base_pay_20ft || 0),
      '40ft': parseFloat(c.base_pay_40ft || 0),
      '45ft': parseFloat(c.base_pay_45ft || 0),
      '53ft': parseFloat(c.base_pay_53ft || 0)
    };
    const basePay = sizePayMap[c.container_size] || 0;
    const pieceBonusMin = parseInt(c.piece_bonus_min || 0);
    const skuBonusMin = parseInt(c.sku_bonus_min || 0);
    const pieces = parseInt(total_pieces || 0);
    const skus = parseInt(sku_count || 0);
    const piecePay = pieces > pieceBonusMin ? parseFloat(c.piece_bonus || 0) * pieces : 0;
    const skuPay = skus > skuBonusMin ? parseFloat(c.sku_bonus || 0) * skus : 0;
    const waitPay = parseFloat(c.wait_time_pay || 0) * parseInt(c.wait_time || 0);
    const workerCount = parseInt(c.worker_count || 1);
    const totalBeforeSplit = basePay + piecePay + skuPay + waitPay;
    const totalPerWorker = totalBeforeSplit / workerCount;
    const result = await pool.query(
      `UPDATE containers SET
        checkout_time=NOW(), end_time=NOW(),
        total_pieces=$1, sku_count=$2,
        total_earning=$3, status='completed'
       WHERE id=$4 RETURNING *`,
      [pieces, skus, totalPerWorker.toFixed(2), req.params.id]
    );
    if (c.co_worker_ids && c.co_worker_ids.length > 0) {
      for (const coWorkerId of c.co_worker_ids) {
        await pool.query(
          `INSERT INTO containers (shift_id, employee_id, container_number, container_size,
            checkin_time, start_time, checkout_time, end_time,
            total_pieces, sku_count, total_earning, status, worker_count)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW(),$7,$8,$9,'completed',$10)`,
          [c.shift_id, coWorkerId, c.container_number, c.container_size,
           c.checkin_time, c.start_time, pieces, skus,
           totalPerWorker.toFixed(2), workerCount]
        );
      }
    }
    res.json({ ...result.rows[0], total_earning: totalPerWorker.toFixed(2), worker_count: workerCount, total_before_split: totalBeforeSplit.toFixed(2) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/warehouses/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM warehouses WHERE id=$1', [req.params.id]);
    res.json(result.rows[0]);
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

app.get('/my-active-shifts-v2', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, w.name as warehouse_name, w.address as warehouse_address,
              sa.status as assignment_status,
              COUNT(c.id) as total_containers,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_containers
       FROM shifts s
       JOIN shift_assignments sa ON sa.shift_id = s.id AND sa.employee_id = $1
       JOIN warehouses w ON s.warehouse_id = w.id
       LEFT JOIN containers c ON c.shift_id = s.id
       WHERE sa.status != 'rejected'
       GROUP BY s.id, w.name, w.address, sa.status
       HAVING COUNT(c.id) = 0
          OR COUNT(CASE WHEN c.status != 'completed' THEN 1 END) > 0
       ORDER BY s.shift_date DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/containers/checkin/v2', auth, async (req, res) => {
  try {
    const { shift_id, container_number, container_size } = req.body;
    const existing = await pool.query(
      `SELECT * FROM containers 
       WHERE shift_id=$1 AND container_size=$2 AND status='planned' AND employee_id IS NULL
       LIMIT 1`,
      [shift_id, container_size]
    );
    if (existing.rows.length === 0) {
      return res.status(400).json({ error: 'No available container of this size for this shift' });
    }
    const container = existing.rows[0];
    const result = await pool.query(
      `UPDATE containers SET 
        employee_id=$1, container_number=$2, status='checked_in', checkin_time=NOW()
       WHERE id=$3 RETURNING *`,
      [req.user.id, container_number, container.id]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/:id/containers/v2', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT c.*, u.name as employee_name 
       FROM containers c 
       LEFT JOIN users u ON c.employee_id = u.id 
       WHERE c.shift_id = $1
       AND (
         c.status = 'planned'
         OR c.employee_id = $2
         OR (c.co_worker_ids IS NOT NULL AND $2 = ANY(c.co_worker_ids))
         OR (c.status != 'completed' AND c.employee_id IS NOT NULL)
       )
       ORDER BY c.created_at ASC`,
      [req.params.id, userId]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/dashboard', auth, async (req, res) => {
  try {
    const activeContainers = await pool.query(
      `SELECT c.*, u.name as employee_name, w.name as warehouse_name
       FROM containers c
       LEFT JOIN users u ON c.employee_id = u.id
       LEFT JOIN shifts s ON c.shift_id = s.id
       LEFT JOIN warehouses w ON s.warehouse_id = w.id
       WHERE c.status IN ('checked_in', 'in_progress')
       ORDER BY c.checkin_time DESC`
    );
    const weeklyStats = await pool.query(
      `SELECT 
        COUNT(DISTINCT c.employee_id) as employees_worked,
        COUNT(c.id) as containers_completed,
        COALESCE(SUM(CASE WHEN c.status='completed' THEN c.total_earning::numeric ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN c.status='completed' AND (c.payment_status IS NULL OR c.payment_status != 'paid') THEN c.total_earning::numeric ELSE 0 END), 0) as total_unpaid
       FROM containers c
       WHERE c.created_at >= NOW() - INTERVAL '7 days'`
    );
    const todayShifts = await pool.query(
      `SELECT s.*, w.name as warehouse_name, w.address as warehouse_address,
              COUNT(sa.id) as employee_count
       FROM shifts s
       LEFT JOIN warehouses w ON s.warehouse_id = w.id
       LEFT JOIN shift_assignments sa ON sa.shift_id = s.id AND sa.status = 'confirmed'
       WHERE DATE(s.shift_date) = CURRENT_DATE
       GROUP BY s.id, w.name, w.address
       ORDER BY s.start_time ASC`
    );
    const topEarners = await pool.query(
      `SELECT u.name, u.id,
              COALESCE(SUM(c.total_earning::numeric), 0) as total_earned,
              COUNT(c.id) as containers_done
       FROM users u
       LEFT JOIN containers c ON c.employee_id = u.id
         AND c.created_at >= NOW() - INTERVAL '7 days'
         AND c.status = 'completed'
       WHERE u.role = 'employee'
       GROUP BY u.id, u.name
       ORDER BY total_earned DESC
       LIMIT 5`
    );
    res.json({
      active_containers: activeContainers.rows,
      weekly_stats: weeklyStats.rows[0],
      today_shifts: todayShifts.rows,
      top_earners: topEarners.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/shifts/completed', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, w.name as warehouse_name,
              COUNT(c.id) as total_containers,
              COUNT(CASE WHEN c.status='completed' THEN 1 END) as completed_containers
       FROM shifts s
       LEFT JOIN warehouses w ON s.warehouse_id = w.id
       LEFT JOIN containers c ON c.shift_id = s.id
       GROUP BY s.id, w.name
       HAVING COUNT(c.id) > 0 
          AND COUNT(c.id) = COUNT(CASE WHEN c.status='completed' THEN 1 END)
       ORDER BY s.shift_date DESC
       LIMIT 30`,
      []
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
