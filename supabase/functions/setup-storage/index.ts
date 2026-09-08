// 一次性运维函数：清理测试预约数据（ZZ-测试公司*）
// 用法：POST /functions/v1/setup-storage（无 body 要求）
// 部署：npx supabase functions deploy setup-storage --project-ref hnnjrqpefhbbwzdnewib --no-verify-jwt
import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};
const pool = new Pool(DB_URL, 1);
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const c = await pool.connect();
  try {
    const r = await c.queryObject(
      `DELETE FROM bookings WHERE company LIKE 'ZZ-测试公司%' RETURNING id, company, date`,
    );
    return new Response(JSON.stringify({ ok: true, deleted: r.rows.length, rows: r.rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ err: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally { c.release(); }
});
