-- 网站统计的只读接口。安装于已有核心 schema、audit 与 bullet-review 模块之后。
-- 审计正文不离开数据库；只返回重建逐日数量所需的身份、父关系、标签与字符数。
begin;

create or replace function public.read_knowledge_statistics_history()
returns jsonb language plpgsql stable security definer
set search_path = '' as $$
declare
    result jsonb;
begin
    -- 网站已有的专用服务端凭据负责授权。公共 key 单独调用时会明确拒绝。
    -- SECURITY DEFINER 仅用于读取已隔离的 audit；不授予调用者任何审计表权限。
    perform public.bullet_draft_reader_authorized();

    select jsonb_build_object(
        'observed_at', current_timestamp,
        'coverage_start', (select min(changed_at) from audit.row_change),
        'bullets', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', b.id::text, 'parent_id', b.parent_id::text, 'characters', char_length(b.body)
        ) order by b.id), '[]'::jsonb) from public.bullet b),
        'tags', (select coalesce(jsonb_agg(jsonb_build_object(
            'bullet_id', t.bullet_id::text, 'tag', t.tag
        ) order by t.bullet_id, t.tag), '[]'::jsonb) from public.bullet_tag t),
        'events', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id::text, 'at', c.changed_at, 'table', c.table_name,
            'changed', c.old_row is distinct from c.new_row,
            'before', case when c.old_row is null then null
                when c.table_name = 'bullet' then jsonb_build_object(
                    'id', c.old_row->>'id', 'parent_id', c.old_row->>'parent_id',
                    'characters', char_length(c.old_row->>'body'))
                else jsonb_build_object('bullet_id', c.old_row->>'bullet_id', 'tag', c.old_row->>'tag') end,
            'after', case when c.new_row is null then null
                when c.table_name = 'bullet' then jsonb_build_object(
                    'id', c.new_row->>'id', 'parent_id', c.new_row->>'parent_id',
                    'characters', char_length(c.new_row->>'body'))
                else jsonb_build_object('bullet_id', c.new_row->>'bullet_id', 'tag', c.new_row->>'tag') end
        ) order by c.changed_at, c.id), '[]'::jsonb)
        from audit.row_change c
        where c.table_schema = 'public' and c.table_name in ('bullet', 'bullet_tag'))
    ) into result;
    return result;
end;
$$;

revoke all on function public.read_knowledge_statistics_history() from public, anon, authenticated, service_role;
grant execute on function public.read_knowledge_statistics_history() to anon, authenticated;

commit;
