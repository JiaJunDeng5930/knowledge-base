-- 预览数据独立于核心知识模型；草稿不安装 audit 行历史 trigger。
begin;

-- 此函数只校验文档结构，不执行数据库操作。
create function public.bullet_draft_document_valid(document jsonb)
returns boolean language plpgsql immutable parallel safe
set search_path = '' as $$
declare
    item record;
    parent jsonb;
    entry jsonb;
begin
    if jsonb_typeof(document) is distinct from 'object' then return false; end if;
    for item in select * from jsonb_each(document) loop
        if item.key !~ '^-?[1-9][0-9]*$' then return false; end if;
        perform item.key::bigint;
        if jsonb_typeof(item.value) is distinct from 'object'
            or not (item.value ?& array['body','parent_id','depth','sibling_order','tags','references'])
            or item.value - array['body','parent_id','depth','sibling_order','tags','references'] <> '{}'::jsonb
            or jsonb_typeof(item.value->'body') is distinct from 'string'
            or jsonb_typeof(item.value->'depth') is distinct from 'number'
            or (item.value->>'depth') !~ '^(0|[1-9][0-9]*)$'
            or jsonb_typeof(item.value->'sibling_order') is distinct from 'string'
            or (item.value->>'sibling_order') !~ '^(0|-?[1-9][0-9]*)$'
            or jsonb_typeof(item.value->'tags') is distinct from 'array'
            or jsonb_typeof(item.value->'references') is distinct from 'array'
        then return false; end if;
        perform (item.value->>'sibling_order')::bigint;
        perform (item.value->>'depth')::integer;
        if item.value->'parent_id' = 'null'::jsonb then
            if (item.value->>'depth')::integer <> 0 then return false; end if;
        else
            if jsonb_typeof(item.value->'parent_id') is distinct from 'string' then return false; end if;
            parent := document->(item.value->>'parent_id');
            if parent is null or (parent->>'depth')::integer + 1 <> (item.value->>'depth')::integer
            then return false; end if;
        end if;
        for entry in select * from jsonb_array_elements(item.value->'tags') loop
            if jsonb_typeof(entry) is distinct from 'string' then return false; end if;
        end loop;
        for entry in select * from jsonb_array_elements(item.value->'references') loop
            if jsonb_typeof(entry) is distinct from 'string' or not (document ? (entry #>> '{}')) then return false; end if;
        end loop;
        if (select count(*) <> count(distinct value) from jsonb_array_elements(item.value->'tags'))
            or (select count(*) <> count(distinct value) from jsonb_array_elements(item.value->'references'))
        then return false; end if;
    end loop;
    return not exists (
        select 1 from jsonb_each(document)
        group by value->>'parent_id', (value->>'sibling_order')::bigint having count(*) > 1
    );
exception when data_exception then return false;
end;
$$;

-- 一条 SQL 读取创建草稿及提交校验所需的正式 bullet 快照。
create view public.bullet_draft_source with (security_invoker = true) as
select coalesce(jsonb_object_agg(b.id::text, jsonb_build_object(
    'body', b.body, 'parent_id', b.parent_id::text, 'depth', b.depth,
    'sibling_order', b.sibling_order::text,
    'tags', (select coalesce(jsonb_agg(t.tag order by t.tag), '[]'::jsonb)
             from public.bullet_tag t where t.bullet_id = b.id),
    'references', (select coalesce(jsonb_agg(r.target_bullet_id::text order by r.target_bullet_id), '[]'::jsonb)
                   from public.bullet_reference r where r.source_bullet_id = b.id)
)), '{}'::jsonb) as document from public.bullet b;

create table public.bullet_draft (
    id uuid primary key default gen_random_uuid(),
    singleton boolean not null default true unique check (singleton),
    base jsonb not null check (public.bullet_draft_document_valid(base)),
    proposed jsonb not null check (public.bullet_draft_document_valid(proposed)),
    processed_comment_ids text[] not null default '{}',
    updated_at timestamptz not null default clock_timestamp()
);

-- 专用服务端读取凭据：安装时只替换 SHA-256，原始密钥仅保存在 Sites secret。
-- 公共 Supabase key 或普通登录不足以读取草稿；没有专用凭据时明确拒绝，
-- 避免网站把权限错误误判成“草稿已提交”并清理批注。占位符未替换时默认拒绝。
create function public.bullet_draft_reader_authorized()
returns boolean language plpgsql stable
set search_path = '' as $$
declare
    headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
    key_hash text := encode(sha256(convert_to(coalesce(headers->>'x-bullet-draft-key', ''), 'UTF8')), 'hex');
begin
    if key_hash <> '__BULLET_DRAFT_KEY_SHA256__' then
        raise insufficient_privilege using message = 'Bullet draft reader credential required';
    end if;
    return true;
end;
$$;

alter table public.bullet_draft enable row level security;
revoke all on public.bullet_draft, public.bullet_draft_source from public, anon, authenticated, service_role;
grant select on public.bullet_draft to anon, authenticated;
create policy bullet_draft_read on public.bullet_draft for select to anon, authenticated
    using ((select public.bullet_draft_reader_authorized()));
revoke execute on function public.bullet_draft_reader_authorized() from public, anon, authenticated, service_role;
grant execute on function public.bullet_draft_reader_authorized() to anon, authenticated;
revoke execute on function public.bullet_draft_document_valid(jsonb) from public, anon, authenticated, service_role;
commit;
