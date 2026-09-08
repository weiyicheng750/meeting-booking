-- 第 2 段：建两个视图
-- booking_slots：只暴露 id/room_id/date/time/status，不含公司、电话等隐私
-- public_settings：只暴露规则 settings，不暴露 webhook/邮箱等通知 webhook

CREATE OR REPLACE VIEW booking_slots AS
  SELECT id, room_id, date, start_time, end_time, status
  FROM bookings;

CREATE OR REPLACE VIEW public_settings AS
  SELECT key, value FROM settings WHERE key = 'rules';
