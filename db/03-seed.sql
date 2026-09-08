-- 第 3 段：写入种子数据（默认会议室、规则、通知、管理员密码）

INSERT INTO admin_auth (key, value) VALUES ('adminPass', 'appleipad2')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO rooms (id, name, short_name, capacity, location, description, icon, color, sort, enabled) VALUES
  ('cx-small', '创新大厦·小会议室', '小会议室', 8,  '中关村生命科学园·创新大厦5层', '适合小组讨论、远程视频会议', 'users',       'blue',   1, TRUE),
  ('cx-big',   '创新大厦·大会议室', '大会议室', 20, '中关村生命科学园·创新大厦5层', '适合部门会议、培训、路演', 'presentation', 'purple', 2, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('rules', '{"advanceDays":7,"workStart":"08:00","workEnd":"20:00","minDuration":30,"hourDuration":60,"perCompanyLimit":1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('notify', '{"webhook":"","serverChan":"","email":"","notifyOnNew":true,"notifyOnCancel":true,"remindBefore":15}'::jsonb)
ON CONFLICT (key) DO NOTHING;
