-- GuanDan tournament DB schema (SQLite via libSQL)
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rule_config TEXT DEFAULT '{}',   -- JSON: pair rules, promotion, scoring etc (TBD by user)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  status TEXT DEFAULT 'registered',
  registered_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, player_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  group_no INTEGER NOT NULL,
  player_ids TEXT NOT NULL,   -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  group_id INTEGER,
  round_no INTEGER NOT NULL,
  team_a TEXT NOT NULL,        -- JSON array of player ids
  team_b TEXT NOT NULL,        -- JSON array of player ids
  score_a INTEGER,
  score_b INTEGER,
  points_a INTEGER,
  points_b INTEGER,
  recorded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
