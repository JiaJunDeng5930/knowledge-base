import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { fetchSupabaseDraft } from "@/lib/supabase-draft";
import { parseCommentInput, readBulletReview, ReviewRequestError, saveReviewComment } from "@/lib/bullet-review-store";

export async function POST(request: Request) {
  const headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"};
  if (!await getChatGPTUser()) return Response.json({error: "请先登录。"}, {status: 401, headers});
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({error: "请从知识库页面发送批注。"}, {status: 403, headers});
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({error: "批注格式不正确。"}, {status: 415, headers});
  if (!env.DB || !env.SUPABASE_URL || !env.SUPABASE_KEY || !env.SUPABASE_DRAFT_READ_KEY) return Response.json({error: "预览与批注尚未配置。"}, {status: 503, headers});
  try {
    const text = await request.text();
    if (text.length > 24000) throw new ReviewRequestError("批注过长。", 413);
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new ReviewRequestError("批注格式不正确。"); }
    const draft = await fetchSupabaseDraft(env.SUPABASE_URL, env.SUPABASE_KEY, env.SUPABASE_DRAFT_READ_KEY);
    const comment = parseCommentInput(input, draft);
    await saveReviewComment(env.DB, comment);
    return Response.json(await readBulletReview(env.DB, draft), {status: 201, headers});
  } catch (error) {
    return Response.json({error: error instanceof ReviewRequestError ? error.message : "暂时无法保存批注，你输入的内容仍会保留。"}, {status: error instanceof ReviewRequestError ? error.status : 502, headers});
  }
}
