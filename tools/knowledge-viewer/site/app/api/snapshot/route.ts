import { env } from "cloudflare:workers";
import { fetchSupabaseSnapshot } from "@/lib/supabase-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = env as unknown as { SUPABASE_URL?: string; SUPABASE_KEY?: string };
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    return Response.json({error: "尚未连接知识库。"}, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
  try {
    const snapshot = await fetchSupabaseSnapshot(config.SUPABASE_URL, config.SUPABASE_KEY);
    return Response.json(snapshot, {headers: {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}});
  } catch {
    return Response.json({error: "暂时无法读取知识库，请稍后重试。"}, {status: 502, headers: {"Cache-Control": "no-store"}});
  }
}

function methodNotAllowed() { return new Response(null, {status: 405, headers: {Allow: "GET"}}); }
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
