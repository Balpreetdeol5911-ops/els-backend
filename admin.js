const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: 'postgresql://postgres:muqEozzEGKFLwATvDrZyoTgTWNcQqEhd@switchyard.proxy.rlwy.net:28735/railway', ssl: { rejectUnauthorized: false } });
bcrypt.hash('ELS2024admin', 10).then(hash => {
  return pool.query("INSERT INTO users (name, email, password, role) VALUES ('Admin', 'admin@els.com', $1, 'admin') ON CONFLICT (email) DO NOTHING", [hash]);
}).then(() => { console.log('Admin created!'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
