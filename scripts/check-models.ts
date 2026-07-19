import Database from 'better-sqlite3';
const db = new Database('data/novels.db', { readonly: true });
try {
  const u = db.prepare('SELECT model, operation, agent_id, created_at FROM token_usage ORDER BY rowid DESC LIMIT 20').all();
  console.log(u);
} catch (e) { console.log('token_usage', (e as Error).message); }
try {
  const cols = db.prepare('PRAGMA table_info(token_usage)').all();
  console.log('cols', cols);
} catch (e) {}
