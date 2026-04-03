// ELS Backend - index.js
// Eastside Lumping Solutions - Complete Backend
// Railway deployment: https://els-backend-production.up.railway.app

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ========================
// DATABASE INITIALIZATION
// ========================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT DEFAULT 'worker',
      hourly_rate NUMERIC(10,2) DEFAULT 20.00,
      status TEXT DEFAULT 'active',
      sin_last4 TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      default_rate NUMERIC(10,2) DEFAULT 55.00,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER REFERENCES warehouses(id),
      date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shift_employees (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
      employee_id INTEGER REFERENCES employees(id),
      hours_worked NUMERIC(10,2),
      status TEXT DEFAULT 'assigned',
      check_in_time TIMESTAMP,
      check_out_time TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS containers (
      id SERIAL PRIMARY KEY,
      container_number TEXT NOT NULL,
      shift_id INTEGER REFERENCES shifts(id),
      warehouse_id INTEGER REFERENCES warehouses(id),
      status TEXT DEFAULT 'pending',
      type TEXT,
      notes TEXT,
      assigned_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER REFERENCES warehouses(id),
      invoice_number TEXT UNIQUE NOT NULL,
      date_issued DATE DEFAULT CURRENT_DATE,
      due_date DATE,
      subtotal NUMERIC(10,2) DEFAULT 0,
      tax_rate NUMERIC(5,4) DEFAULT 0.05,
      tax_amount NUMERIC(10,2) DEFAULT 0,
      total NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) DEFAULT 1,
      unit_price NUMERIC(10,2) DEFAULT 0,
      line_total NUMERIC(10,2) DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS time_off_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payroll_records (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      pay_period_start DATE,
      pay_period_end DATE,
      hours_total NUMERIC(10,2) DEFAULT 0,
      gross_pay NUMERIC(10,2) DEFAULT 0,
      deductions NUMERIC(10,2) DEFAULT 0,
      net_pay NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("Database tables initialized");
}

initDB().catch(console.error);

// ========================
// HEALTH
// ========================
app.get("/", (req, res) => res.json({ status: "ELS Backend Running", version: "2.0" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ========================
// EMPLOYEES (Admin CRUD)
// ========================
app.get("/admin/employees", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM employees ORDER BY name");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/employees", async (req, res) => {
  try {
    const { name, email, phone, role, hourly_rate, status, sin_last4 } = req.body;
    const r = await pool.query(
      "INSERT INTO employees (name, email, phone, role, hourly_rate, status, sin_last4) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [name, email, phone, role || "worker", hourly_rate || 20, status || "active", sin_last4]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/employees/:id", async (req, res) => {
  try {
    const { name, email, phone, role, hourly_rate, status, sin_last4 } = req.body;
    const r = await pool.query(
      "UPDATE employees SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone), role=COALESCE($4,role), hourly_rate=COALESCE($5,hourly_rate), status=COALESCE($6,status), sin_last4=COALESCE($7,sin_last4) WHERE id=$8 RETURNING *",
      [name, email, phone, role, hourly_rate, status, sin_last4, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/employees/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM employees WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// WAREHOUSES (Admin CRUD)
// ========================
app.get("/admin/warehouses", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM warehouses ORDER BY name");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/warehouses", async (req, res) => {
  try {
    const { name, address, contact_name, contact_email, contact_phone, default_rate, notes } = req.body;
    const r = await pool.query(
      "INSERT INTO warehouses (name, address, contact_name, contact_email, contact_phone, default_rate, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [name, address, contact_name, contact_email, contact_phone, default_rate || 55, notes]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/warehouses/:id", async (req, res) => {
  try {
    const { name, address, contact_name, contact_email, contact_phone, default_rate, notes, status } = req.body;
    const r = await pool.query(
      "UPDATE warehouses SET name=COALESCE($1,name), address=COALESCE($2,address), contact_name=COALESCE($3,contact_name), contact_email=COALESCE($4,contact_email), contact_phone=COALESCE($5,contact_phone), default_rate=COALESCE($6,default_rate), notes=COALESCE($7,notes), status=COALESCE($8,status) WHERE id=$9 RETURNING *",
      [name, address, contact_name, contact_email, contact_phone, default_rate, notes, status, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// SHIFTS (Admin CRUD + employee management)
// ========================
app.get("/admin/shifts", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.*, w.name as warehouse_name,
        COALESCE(json_agg(json_build_object('id', se.id, 'employee_id', se.employee_id, 'employee_name', e.name, 'hours_worked', se.hours_worked, 'status', se.status, 'check_in_time', se.check_in_time, 'check_out_time', se.check_out_time)) FILTER (WHERE se.id IS NOT NULL), '[]') as employees
      FROM shifts s
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN shift_employees se ON se.shift_id = s.id
      LEFT JOIN employees e ON se.employee_id = e.id
      GROUP BY s.id, w.name
      ORDER BY s.date DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/shifts", async (req, res) => {
  try {
    const { warehouse_id, date, start_time, end_time, notes, employee_ids } = req.body;
    const r = await pool.query(
      "INSERT INTO shifts (warehouse_id, date, start_time, end_time, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [warehouse_id, date, start_time, end_time, notes]
    );
    const shift = r.rows[0];
    if (employee_ids && employee_ids.length > 0) {
      for (const eid of employee_ids) {
        await pool.query("INSERT INTO shift_employees (shift_id, employee_id) VALUES ($1,$2)", [shift.id, eid]);
      }
    }
    res.json(shift);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/shifts/:id", async (req, res) => {
  try {
    const { warehouse_id, date, start_time, end_time, status, notes } = req.body;
    const r = await pool.query(
      "UPDATE shifts SET warehouse_id=COALESCE($1,warehouse_id), date=COALESCE($2,date), start_time=COALESCE($3,start_time), end_time=COALESCE($4,end_time), status=COALESCE($5,status), notes=COALESCE($6,notes) WHERE id=$7 RETURNING *",
      [warehouse_id, date, start_time, end_time, status, notes, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Shift Employee Management (ADD/REMOVE/UPDATE) ----
app.post("/admin/shifts/:id/employees", async (req, res) => {
  try {
    const { employee_id } = req.body;
    const r = await pool.query(
      "INSERT INTO shift_employees (shift_id, employee_id) VALUES ($1,$2) RETURNING *",
      [req.params.id, employee_id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/shifts/:shiftId/employees/:empId", async (req, res) => {
  try {
    await pool.query("DELETE FROM shift_employees WHERE shift_id=$1 AND employee_id=$2", [req.params.shiftId, req.params.empId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/shift-employees/:id", async (req, res) => {
  try {
    const { hours_worked, status, check_in_time, check_out_time } = req.body;
    const r = await pool.query(
      "UPDATE shift_employees SET hours_worked=COALESCE($1,hours_worked), status=COALESCE($2,status), check_in_time=COALESCE($3,check_in_time), check_out_time=COALESCE($4,check_out_time) WHERE id=$5 RETURNING *",
      [hours_worked, status, check_in_time, check_out_time, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// CONTAINERS
// ========================
app.get("/admin/containers", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*, w.name as warehouse_name, s.date as shift_date
      FROM containers c
      LEFT JOIN warehouses w ON c.warehouse_id = w.id
      LEFT JOIN shifts s ON c.shift_id = s.id
      ORDER BY c.assigned_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/containers", async (req, res) => {
  try {
    const { container_number, shift_id, warehouse_id, type, notes } = req.body;
    const r = await pool.query(
      "INSERT INTO containers (container_number, shift_id, warehouse_id, type, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [container_number, shift_id, warehouse_id, type, notes]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/containers/:id", async (req, res) => {
  try {
    const { container_number, shift_id, warehouse_id, status, type, notes } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;
    if (container_number !== undefined) { fields.push(`container_number=$${idx++}`); vals.push(container_number); }
    if (shift_id !== undefined) { fields.push(`shift_id=$${idx++}`); vals.push(shift_id); }
    if (warehouse_id !== undefined) { fields.push(`warehouse_id=$${idx++}`); vals.push(warehouse_id); }
    if (status !== undefined) { fields.push(`status=$${idx++}`); vals.push(status); }
    if (type !== undefined) { fields.push(`type=$${idx++}`); vals.push(type); }
    if (notes !== undefined) { fields.push(`notes=$${idx++}`); vals.push(notes); }
    if (status === "completed") { fields.push(`completed_at=NOW()`); }
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE containers SET ${fields.join(",")} WHERE id=$${idx} RETURNING *`, vals);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Container reassignment
app.put("/admin/containers/:id/reassign", async (req, res) => {
  try {
    const { shift_id, warehouse_id } = req.body;
    const r = await pool.query(
      "UPDATE containers SET shift_id=COALESCE($1,shift_id), warehouse_id=COALESCE($2,warehouse_id), assigned_at=NOW() WHERE id=$3 RETURNING *",
      [shift_id, warehouse_id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// INVOICES
// ========================
app.get("/admin/invoices", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT i.*, w.name as warehouse_name,
        COALESCE(json_agg(json_build_object('id', il.id, 'description', il.description, 'quantity', il.quantity, 'unit_price', il.unit_price, 'line_total', il.line_total)) FILTER (WHERE il.id IS NOT NULL), '[]') as lines
      FROM invoices i
      LEFT JOIN warehouses w ON i.warehouse_id = w.id
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      GROUP BY i.id, w.name
      ORDER BY i.date_issued DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/invoices", async (req, res) => {
  try {
    const { warehouse_id, due_date, notes, tax_rate, lines } = req.body;
    // Generate invoice number: ELS-YYYYMMDD-XXXX
    const countR = await pool.query("SELECT COUNT(*) as c FROM invoices");
    const num = String(parseInt(countR.rows[0].c) + 1).padStart(4, "0");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const invoice_number = `ELS-${today}-${num}`;
    const tr = parseFloat(tax_rate) || 0.05;

    const r = await pool.query(
      "INSERT INTO invoices (warehouse_id, invoice_number, due_date, notes, tax_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [warehouse_id, invoice_number, due_date, notes, tr]
    );
    const inv = r.rows[0];

    let subtotal = 0;
    if (lines && lines.length > 0) {
      for (const ln of lines) {
        const lt = (parseFloat(ln.quantity) || 1) * (parseFloat(ln.unit_price) || 0);
        subtotal += lt;
        await pool.query(
          "INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)",
          [inv.id, ln.description, ln.quantity || 1, ln.unit_price || 0, lt]
        );
      }
    }
    const tax_amount = subtotal * tr;
    const total = subtotal + tax_amount;
    const updated = await pool.query(
      "UPDATE invoices SET subtotal=$1, tax_amount=$2, total=$3 WHERE id=$4 RETURNING *",
      [subtotal, tax_amount, total, inv.id]
    );
    res.json(updated.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/invoices/:id", async (req, res) => {
  try {
    const { status, notes, due_date } = req.body;
    const r = await pool.query(
      "UPDATE invoices SET status=COALESCE($1,status), notes=COALESCE($2,notes), due_date=COALESCE($3,due_date) WHERE id=$4 RETURNING *",
      [status, notes, due_date, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// TIME-OFF REQUESTS
// ========================
app.get("/admin/time-off", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*, e.name as employee_name
      FROM time_off_requests t
      LEFT JOIN employees e ON t.employee_id = e.id
      ORDER BY t.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/time-off/:id", async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const r = await pool.query(
      "UPDATE time_off_requests SET status=COALESCE($1,status), admin_notes=COALESCE($2,admin_notes), reviewed_at=NOW() WHERE id=$3 RETURNING *",
      [status, admin_notes, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee submits time-off
app.post("/employee/time-off", async (req, res) => {
  try {
    const { employee_id, start_date, end_date, reason } = req.body;
    const r = await pool.query(
      "INSERT INTO time_off_requests (employee_id, start_date, end_date, reason) VALUES ($1,$2,$3,$4) RETURNING *",
      [employee_id, start_date, end_date, reason]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee views own time-off
app.get("/employee/:id/time-off", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM time_off_requests WHERE employee_id=$1 ORDER BY created_at DESC", [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// T4 YEAR-END SUMMARY
// ========================
app.get("/admin/t4-summary", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const r = await pool.query(`
      SELECT e.id, e.name, e.sin_last4,
        COALESCE(SUM(se.hours_worked), 0) as total_hours,
        COALESCE(SUM(se.hours_worked * e.hourly_rate), 0) as gross_earnings
      FROM employees e
      LEFT JOIN shift_employees se ON se.employee_id = e.id
      LEFT JOIN shifts s ON se.shift_id = s.id AND EXTRACT(YEAR FROM s.date) = $1
      WHERE e.status = 'active'
      GROUP BY e.id, e.name, e.sin_last4
      ORDER BY e.name
    `, [year]);
    res.json({ year: parseInt(year), employees: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// CSV EXPORT
// ========================
app.get("/admin/export/:type", async (req, res) => {
  try {
    const { type } = req.params;
    let query, filename;
    switch (type) {
      case "employees":
        query = "SELECT id, name, email, phone, role, hourly_rate, status, created_at FROM employees ORDER BY name";
        filename = "els_employees.csv";
        break;
      case "shifts":
        query = `SELECT s.id, s.date, s.start_time, s.end_time, s.status, w.name as warehouse FROM shifts s LEFT JOIN warehouses w ON s.warehouse_id=w.id ORDER BY s.date DESC`;
        filename = "els_shifts.csv";
        break;
      case "invoices":
        query = `SELECT i.id, i.invoice_number, i.date_issued, i.due_date, i.subtotal, i.tax_amount, i.total, i.status, w.name as warehouse FROM invoices i LEFT JOIN warehouses w ON i.warehouse_id=w.id ORDER BY i.date_issued DESC`;
        filename = "els_invoices.csv";
        break;
      case "containers":
        query = `SELECT c.id, c.container_number, c.status, c.type, w.name as warehouse, s.date as shift_date FROM containers c LEFT JOIN warehouses w ON c.warehouse_id=w.id LEFT JOIN shifts s ON c.shift_id=s.id ORDER BY c.assigned_at DESC`;
        filename = "els_containers.csv";
        break;
      case "payroll":
        query = `SELECT e.name, SUM(se.hours_worked) as total_hours, e.hourly_rate, SUM(se.hours_worked * e.hourly_rate) as gross_pay FROM shift_employees se JOIN employees e ON se.employee_id=e.id JOIN shifts s ON se.shift_id=s.id GROUP BY e.id, e.name, e.hourly_rate ORDER BY e.name`;
        filename = "els_payroll.csv";
        break;
      default:
        return res.status(400).json({ error: "Invalid export type" });
    }
    const r = await pool.query(query);
    if (r.rows.length === 0) return res.json({ csv: "", filename });
    const headers = Object.keys(r.rows[0]);
    const csvRows = [headers.join(",")];
    for (const row of r.rows) {
      csvRows.push(headers.map(h => {
        const v = row[h];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","));
    }
    res.json({ csv: csvRows.join("\n"), filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// EMPLOYEE-FACING ROUTES
// ========================
app.get("/employee/:id/profile", async (req, res) => {
  try {
    const r = await pool.query("SELECT id, name, email, phone, role, hourly_rate, status FROM employees WHERE id=$1", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/employee/:id/shifts", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.id, s.date, s.start_time, s.end_time, s.status, w.name as warehouse_name,
        se.hours_worked, se.status as assignment_status, se.check_in_time, se.check_out_time
      FROM shift_employees se
      JOIN shifts s ON se.shift_id = s.id
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      WHERE se.employee_id = $1
      ORDER BY s.date DESC
    `, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/employee/:id/earnings", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(SUM(se.hours_worked), 0) as total_hours,
        COALESCE(SUM(se.hours_worked * e.hourly_rate), 0) as total_earnings
      FROM shift_employees se
      JOIN employees e ON se.employee_id = e.id
      WHERE se.employee_id = $1
    `, [req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/employee/:id/checkin", async (req, res) => {
  try {
    const { shift_id } = req.body;
    const r = await pool.query(
      "UPDATE shift_employees SET check_in_time=NOW(), status='checked_in' WHERE shift_id=$1 AND employee_id=$2 RETURNING *",
      [shift_id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/employee/:id/checkout", async (req, res) => {
  try {
    const { shift_id } = req.body;
    const r = await pool.query(`
      UPDATE shift_employees SET check_out_time=NOW(), status='completed',
        hours_worked = EXTRACT(EPOCH FROM (NOW() - check_in_time))/3600
      WHERE shift_id=$1 AND employee_id=$2 RETURNING *
    `, [shift_id, req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee views warehouse pay rates (public rates only)
app.get("/employee/warehouse-rates", async (req, res) => {
  try {
    const r = await pool.query("SELECT id, name, default_rate FROM warehouses WHERE status='active' ORDER BY name");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================
// DASHBOARD STATS
// ========================
app.get("/admin/dashboard", async (req, res) => {
  try {
    const empCount = await pool.query("SELECT COUNT(*) as c FROM employees WHERE status='active'");
    const shiftCount = await pool.query("SELECT COUNT(*) as c FROM shifts WHERE date >= CURRENT_DATE");
    const containerCount = await pool.query("SELECT COUNT(*) as c FROM containers WHERE status='pending'");
    const invoiceTotal = await pool.query("SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE status='sent' OR status='draft'");
    const pendingTimeOff = await pool.query("SELECT COUNT(*) as c FROM time_off_requests WHERE status='pending'");
    res.json({
      active_employees: parseInt(empCount.rows[0].c),
      upcoming_shifts: parseInt(shiftCount.rows[0].c),
      pending_containers: parseInt(containerCount.rows[0].c),
      outstanding_invoices: parseFloat(invoiceTotal.rows[0].t),
      pending_time_off: parseInt(pendingTimeOff.rows[0].c)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ELS Backend running on port ${PORT}`));
