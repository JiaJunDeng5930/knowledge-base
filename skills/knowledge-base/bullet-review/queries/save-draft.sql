-- 替换 draft_id、changes 和 processed_ids 三项参数后执行。
-- changes 按 bullet ID 给出部分字段；null 删除该 bullet；负数 ID 用于新增。
-- 正文是 JSON 字符串；不要把未经转义的内容拼入 SQL。
do $review$
declare
    draft_id uuid := '00000000-0000-4000-8000-000000000000';
    changes jsonb := $changes${}$changes$;
    processed_ids text[] := array[]::text[];
    draft public.bullet_draft;
    item record;
    candidate jsonb;
begin
    select * into strict draft from public.bullet_draft where id = draft_id for update;
    candidate := draft.proposed;
    if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Bullet draft changes must be an object'; end if;
    for item in select * from jsonb_each(changes) loop
        if item.value = 'null'::jsonb then candidate := candidate - item.key;
        else
            if jsonb_typeof(item.value) is distinct from 'object' then raise exception 'Bullet draft patch must be an object'; end if;
            if not (draft.base ? item.key) and item.key !~ '^-[1-9][0-9]*$'
            then raise exception 'New draft bullets require a negative temporary ID'; end if;
            candidate := jsonb_set(candidate, array[item.key], coalesce(candidate->item.key, '{}'::jsonb) || item.value);
        end if;
    end loop;
    update public.bullet_draft set proposed = candidate,
        processed_comment_ids = array(select distinct unnest(draft.processed_comment_ids || processed_ids)),
        updated_at = clock_timestamp()
    where id = draft_id;
end;
$review$;
select id, updated_at from public.bullet_draft;
