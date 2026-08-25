-- GuanDan tournament DB schema (SQLite via libSQL)

-- 選手 / 名單
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  badge_no TEXT UNIQUE,
  contact TEXT,
  note TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 賽事
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rule_config TEXT DEFAULT '{}',
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 報名
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

-- 隊
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  round_no INTEGER,
  member_ids TEXT NOT NULL,
  name TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- 對陣
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  team_a INTEGER,
  team_b INTEGER,
  winner TEXT,
  score_a INTEGER,
  score_b INTEGER,
  points_a INTEGER,
  points_b INTEGER,
  level_a TEXT,            -- 紅隊本局打到的級 (2,3,...,J,Q,K,A1,A2,FIN)
  level_b TEXT,            -- 藍隊本局打到的級
  recorded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (team_a) REFERENCES teams(id),
  FOREIGN KEY (team_b) REFERENCES teams(id)
);
