-- 第 1 段：只建 5 张表（最朴素 SQL，无 DO 块、无过程式语法）
-- 在控制台 SQL 编辑器点运行；如已被权限拦截，先断开重连或用 superuser

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  short_name   TEXT,
  capacity     INT          DEFAULT 10,
  location     TEXT,
  description  TEXT,
  icon         TEXT         DEFAULT 'users',
  color        TEXT         DEFAULT 'blue',
  sort         INT          DEFAULT 999,
  enabled      BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  room_id      TEXT,
  room_name    TEXT,
  company      TEXT,
  name         TEXT,
  phone        TEXT,
  date         TEXT,
  start_time   TEXT,
  end_time     TEXT,
  duration     INT,
  remark       TEXT,
  status       TEXT         DEFAULT 'ok',
  created_at   TIMESTAMPTZ  DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS blackouts (
  id           TEXT PRIMARY KEY,
  room_id      TEXT,
  type         TEXT,
  date         TEXT,
  start_date   TEXT,
  end_date     TEXT,
  weekly_days  JSONB,
  start_time   TEXT,
  end_time     TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  JSONB
);

CREATE TABLE IF NOT EXISTS admin_auth (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
