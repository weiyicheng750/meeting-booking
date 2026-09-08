-- 第 4 段：开放匿名只读权限（不写操作、不读敏感表）
-- 写操作一律走云函数 mbapi（service_role），前端的 anon 不能写
-- 适配 CloudBase 角色名（anon / public 任选其一都能识别）
-- 注意：先确认当前角色名到底是哪个，单独跑 SELECT current_user 看看

GRANT SELECT ON rooms         TO anon;
GRANT SELECT ON rooms         TO PUBLIC;
GRANT SELECT ON blackouts     TO anon;
GRANT SELECT ON blackouts     TO PUBLIC;
GRANT SELECT ON booking_slots TO anon;
GRANT SELECT ON booking_slots TO PUBLIC;
GRANT SELECT ON public_settings TO anon;
GRANT SELECT ON public_settings TO PUBLIC;

-- admin_auth / settings（其中存放 webhook）保持对匿名封闭，仅 service_role 可写可读
-- 注意：service_role 通常默认全权，这里只是显式收紧
REVOKE ALL ON admin_auth FROM anon;
REVOKE ALL ON admin_auth FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON bookings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON bookings FROM PUBLIC;
