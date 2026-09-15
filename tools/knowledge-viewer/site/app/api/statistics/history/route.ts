import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { fetchStatisticsHistory } from "@/features/statistics/statistics-history";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET() {
  if (!await getChatGPTUser()) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY || !env.SUPABASE_DRAFT_READ_KEY) {
    return Response.json({ error: "知识变化记录尚未连接。" }, { status: 503, headers });
  }
  try {
    const history = await fetchStatisticsHistory(env.SUPABASE_URL, env.SUPABASE_KEY, env.SUPABASE_DRAFT_READ_KEY);
    return Response.json(history, { headers });
  } catch {
    return Response.json({ error: "暂时无法读取知识变化记录。" }, { status: 502, headers });
  }
}
function methodNotAllowed() { return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } }); }
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
