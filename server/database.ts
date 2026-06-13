import Database from 'better-sqlite3';

import { DB_PATH, ensureDataDir } from './lib/paths.js';

ensureDataDir();

const db = new Database(DB_PATH);

// Enable WAL mode for better performance.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Migration helper: add column if it doesn't exist ──
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    // eslint-disable-next-line no-console
    console.log(`Migration: added ${table}.${column}`);
  }
}

function initialize(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      keyword TEXT NOT NULL,
      content TEXT DEFAULT '',
      slug TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','generating','completed','failed')),
      error_message TEXT DEFAULT '',
      language TEXT DEFAULT 'English',
      tone TEXT DEFAULT 'informational',
      word_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS html_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT DEFAULT 'running' CHECK(status IN ('running','completed','canceled','failed')),
      total INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','generating','completed','failed','canceled')),
      article_id INTEGER,
      error_message TEXT DEFAULT '',
      started_at DATETIME,
      finished_at DATETIME,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
    );
  `);

  // ── Run migrations for existing databases ──
  addColumnIfMissing('articles', 'slug', "TEXT DEFAULT ''");
  addColumnIfMissing('articles', 'excerpt', "TEXT DEFAULT ''");
  addColumnIfMissing('articles', 'tags', "TEXT DEFAULT '[]'");

  // ── Seed NON-SECRET default settings only ──
  // SECURITY: AI provider URL, model and API key are intentionally NOT seeded
  // here. They are configured by the admin via the First-Run Setup Wizard and
  // stored (encrypted) in the settings table. Never hardcode real credentials.
  const defaultSettings: Array<{ key: string; value: string }> = [
    { key: 'max_tokens', value: '4096' },
    { key: 'temperature', value: '0.7' },
    { key: 'default_language', value: 'English' },
    { key: 'default_tone', value: 'informational' },
    { key: 'rate_limit_ms', value: '2000' },
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value);
  }

  // Seed default prompt (non-secret).
  const promptCount = db.prepare('SELECT COUNT(*) as count FROM prompts').get() as {
    count: number;
  };
  if (promptCount.count === 0) {
    db.prepare(`INSERT INTO prompts (name, template, is_default) VALUES (?, ?, 1)`).run(
      'Default SEO Article',
      `Write a comprehensive, SEO-optimized article about "{keyword}".

Requirements:
- Create an engaging, click-worthy title that includes the keyword
- Structure with H2 and H3 subheadings (use HTML tags)
- Write approximately {length} words
- Include a compelling introduction and strong conclusion
- Use a {tone} tone throughout
- Primary keyword: {keyword}
- Naturally incorporate related LSI keywords
- Write entirely in {language}
- Include practical tips, examples, or data where relevant
- Make it readable with short paragraphs

Format your response EXACTLY as:
TITLE: [Your engaging article title here]
KEYWORD: {keyword}
CONTENT:
[Full article content in HTML format with <h2>, <h3>, <p>, <ul>, <li> tags]`,
    );
  }

  // Seed default HTML template (non-secret).
  const templateCount = db.prepare('SELECT COUNT(*) as count FROM html_templates').get() as {
    count: number;
  };
  if (templateCount.count === 0) {
    db.prepare(`INSERT INTO html_templates (name, content, is_default) VALUES (?, ?, 1)`).run(
      'Clean Blog',
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Georgia', serif; line-height: 1.8; color: #333; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; color: #1a1a1a; }
    h2 { font-size: 1.6rem; margin: 2rem 0 1rem; color: #2a2a2a; border-bottom: 2px solid #eee; padding-bottom: 0.3rem; }
    h3 { font-size: 1.3rem; margin: 1.5rem 0 0.8rem; color: #3a3a3a; }
    p { margin-bottom: 1.2rem; }
    ul, ol { margin: 1rem 0; padding-left: 2rem; }
    li { margin-bottom: 0.5rem; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <article>
    <h1>{{title}}</h1>
    <div class="meta">
      <span>By {{author}}</span> &bull;
      <span>{{date}}</span> &bull;
      <span>Keyword: {{keyword}}</span>
    </div>
    <div class="content">
      {{content}}
    </div>
  </article>
</body>
</html>`,
    );
  }

  // eslint-disable-next-line no-console
  console.log('Database initialized at:', DB_PATH);
}

initialize();

export default db;
