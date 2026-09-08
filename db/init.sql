-- ============================================================
-- 会议室预约系统 · PostgreSQL 初始化脚本
-- 适用环境：meeting-d0gv3pa8v2ae97a3e（PostgreSQL 类型）
-- 用法：CloudBase 控制台 → SQL 编辑器 → 粘贴全部 → 执行
-- ============================================================

-- 1) 会议室
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

-- 2) 预约单
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
  status       TEXT         DEFAULT 'ok',   -- ok | cancelled
  created_at   TIMESTAMPTZ  DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

-- 3) 禁约时段
CREATE TABLE IF NOT EXISTS blackouts (
  id           TEXT PRIMARY KEY,
  room_id      TEXT,
  type         TEXT,                          -- once | range | weekly
  date         TEXT,
  start_date   TEXT,
  end_date     TEXT,
  weekly_days  JSONB,                         -- [0,1,2,...] 0=周日
  start_time   TEXT,
  end_time     TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

-- 4) 设置（规则 / 通知，无敏感信息）
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  JSONB
);

-- 5) 管理员密码（敏感，绝不授权给匿名）
CREATE TABLE IF NOT EXISTS admin_auth (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- 6) 视图：仅暴露预约槽位（不含公司/电话等隐私）
CREATE OR REPLACE VIEW booking_slots AS
  SELECT id, room_id, date, start_time, end_time, status
  FROM bookings;

-- 7) 视图：公开设置（仅规则，不含通知里的 webhook）
CREATE OR REPLACE VIEW public_settings AS
  SELECT key, value FROM settings WHERE key = 'rules';

-- ============================================================
-- 种子数据
-- ============================================================

-- 默认管理员密码（与后台默认密码一致）
INSERT INTO admin_auth (key, value) VALUES ('adminPass', 'CHANGE_ME_2026')
  ON CONFLICT (key) DO NOTHING;

-- 默认会议室
INSERT INTO rooms (id, name, short_name, capacity, location, description, icon, color, sort, enabled) VALUES
  ('cx-small', '创新大厦·小会议室', '小会议室', 8,  '中关村生命科学园·创新大厦5层', '适合小组讨论、远程视频会议', 'users',       'blue',   1, TRUE),
  ('cx-big',   '创新大厦·大会议室', '大会议室', 20, '中关村生命科学园·创新大厦5层', '适合部门会议、培训、路演', 'presentation', 'purple', 2, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 默认规则
INSERT INTO settings (key, value) VALUES
  ('rules', '{"advanceDays":7,"workStart":"08:00","workEnd":"20:00","minDuration":30,"hourDuration":60,"perCompanyLimit":1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 默认通知（webhook 为空，老板可在后台填写企业微信机器人）
INSERT INTO settings (key, value) VALUES
  ('notify', '{"webhook":"","serverChan":"","email":"","notifyOnNew":true,"notifyOnCancel":true,"remindBefore":15}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 权限：匿名仅可读（会议室/禁约/槽位视图/公开设置），不可读写预约隐私
-- 管理类写操作一律走云函数 mbapi（service_role，服务端权限，绕开 RLS）
-- 兼容 CloudBase 可能的角色名：anon / authenticated / public / service_role
-- ============================================================
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','public','service_role'] LOOP
    BEGIN EXECUTE format('GRANT SELECT ON rooms           TO %I', r); EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN EXECUTE format('GRANT SELECT ON blackouts       TO %I', r); EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN EXECUTE format('GRANT SELECT ON booking_slots   TO %I', r); EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN EXECUTE format('GRANT SELECT ON public_settings TO %I', r); EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END$$;
