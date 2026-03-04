const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:muqEozzEGKFLwATvDrZyoTgTWNcQqEhd@switchyard.proxy.rlwy.net:28735/railway', ssl: { rejectUnauthorized: false } });
pool.query(`
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS base_pay_20ft DECIMAL DEFAULT 0;
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS base_pay_40ft DECIMAL DEFAULT 0;
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS base_pay_45ft DECIMAL DEFAULT 0;
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS base_pay_53ft DECIMAL DEFAULT 0;
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS wait_time_pay DECIMAL DEFAULT 0;
  ALTER TABLE containers ADD COLUMN IF NOT EXISTS container_size VARCHAR(10) DEFAULT '40ft';
`).then(() => { console.log('DB updated!'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
