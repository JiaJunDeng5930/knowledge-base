// 运行期值由 Sites 注入，不能进入客户端代码。
declare namespace Cloudflare {
  interface Env {
    SUPABASE_URL?: string;
    SUPABASE_KEY?: string;
    DB?: D1Database;
  }
}
