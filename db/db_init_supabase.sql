-- ============================================================
-- 会议室预约系统 - Supabase 专用初始化脚本
-- 适配说明：
--   1) 把原 01-tables + 02-views + 03-seed 整合成单文件
--   2) 删掉 CloudBase 角色名（anon_role / PUBLIC 特殊处理），
--      改为 Supabase 标准角色（postgres / anon / authenticated）
--   3) Node 服务用 postgres 角色（superuser）直连，无需额外授权
--   4) 如需收紧 Supabase 控制台/API 的查询权限，可自行加 RLS
-- ============================================================

-- ---------- 1. 建表 ----------
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

-- ---------- 2. 视图（隔离隐私） ----------
CREATE OR REPLACE VIEW booking_slots AS
  SELECT id, room_id, date, start_time, end_time, status
  FROM bookings;

CREATE OR REPLACE VIEW public_settings AS
  SELECT key, value FROM settings WHERE key = 'rules';

-- ---------- 3. 种子数据 ----------
INSERT INTO admin_auth (key, value) VALUES ('adminPass', 'CHANGE_ME_2026')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO rooms (id, name, short_name, capacity, location, description, icon, color, sort, enabled) VALUES
  ('cx-small', '创新大厦·小会议室', '小会议室', 8,  '中关村生命科学园·创新大厦5层', '适合小组讨论、远程视频会议', 'users',       'blue',   1, TRUE),
  ('cx-big',   '创新大厦·大会议室', '大会议室', 20, '中关村生命科学园·创新大厦5层', '适合部门会议、培训、路演', 'presentation', 'purple', 2, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('rules', '{"advanceDays":7,"workStart":"08:00","workEnd":"20:00","minDuration":30,"hourDuration":60,"perCompanyLimit":2,"maxDuration":180,"perCompanyDailyCount":2,"perCompanyDailyMinutes":360}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('notify', '{"webhook":"","serverChan":"","email":"","notifyOnNew":true,"notifyOnCancel":true,"remindBefore":15}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------- 4. Supabase 角色权限（可选） ----------
-- 默认 postgres（Node 服务用）是 superuser，无需任何 GRANT。
-- 下面这段是给 Supabase 控制台/API（PostgREST）用的，
-- 让匿名用户/登录用户能通过 Supabase 自带接口读到基础数据。
-- 如果你只走 Node 服务，下面的 GRANT 也可以不跑。
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON rooms, blackouts, booking_slots, public_settings
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings
  TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO authenticated;
