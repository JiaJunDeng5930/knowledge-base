import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { fetchSupabaseDraft } from "@/lib/supabase-draft";
import { readBulletReview } from "@/lib/bullet-review-store";

export const dynamic = "force-dynamic";
export async function GET() {
  const headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"};
  if (!await getChatGPTUser()) return Response.json({error: "请先登录。"}, {status: 401, headers});
  if (!env.DB || !env.SUPABASE_URL || !env.SUPABASE_KEY || !env.SUPABASE_DRAFT_READ_KEY) return Response.json({error: "预览与批注尚未配置。"}, {status: 503, headers});
  try {
    const draft = await fetchSupabaseDraft(env.SUPABASE_URL, env.SUPABASE_KEY, env.SUPABASE_DRAFT_READ_KEY);
    return Response.json(await readBulletReview(env.DB, draft), {headers});
  } catch {
    return Response.json({error: "暂时无法更新预览与批注，请稍后重试。"}, {status: 502, headers});
  }
}
