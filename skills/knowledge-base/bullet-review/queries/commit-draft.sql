-- 仅在用户确认当前整体 diff 后执行。替换唯一的 draft_id 参数。
-- 结构、引用、标签、草稿清理在一个事务中完成；失败全部回滚。
begin;
lock table public.bullet, public.bullet_reference, public.bullet_tag in share row exclusive mode;
do $review$
declare
    draft_id uuid := '00000000-0000-4000-8000-000000000000';
    draft public.bullet_draft;
    current_document jsonb;
    final_document jsonb := '{}';
    id_map jsonb := '{}';
    item record;
    mapped_id text;
    target text;
    body text;
begin
    select * into strict draft from public.bullet_draft where id = draft_id for update;
    select document into current_document from public.bullet_draft_source;
    if current_document <> draft.base then raise exception 'Bullet draft base changed; review the current knowledge before submitting'; end if;
    if exists (select 1 from public.fsrs_bullet f where not (draft.proposed ? f.bullet_id::text))
    then raise exception 'Bullet draft deletion blocked by an FSRS association'; end if;
    for item in select * from jsonb_each(draft.proposed) loop
        if not (draft.base ? item.key) then
            if item.key !~ '^-[1-9][0-9]*$' then raise exception 'New draft bullets require a negative temporary ID'; end if;
            id_map := id_map || jsonb_build_object(item.key, nextval(pg_get_serial_sequence('public.bullet','id'))::text);
        end if;
    end loop;
    for item in select * from jsonb_each(draft.proposed) loop
        mapped_id := coalesce(id_map->>item.key, item.key);
        body := item.value->>'body';
        -- 新增 bullet 的 Markdown 内部链接与关系使用同一编号映射。
        for target in select key from jsonb_each(id_map) loop
            body := regexp_replace(body, '(/bullet/)' || target || '(?=[/)#?[:space:]"<>]|$)', '\1' || (id_map->>target), 'g');
        end loop;
        final_document := final_document || jsonb_build_object(mapped_id, item.value || jsonb_build_object(
            'body', body,
            'parent_id', coalesce(id_map->>(item.value->>'parent_id'), item.value->>'parent_id'),
            'references', (select coalesce(jsonb_agg(coalesce(id_map->>value, value)), '[]'::jsonb)
                            from jsonb_array_elements_text(item.value->'references'))
        ));
    end loop;
    delete from public.bullet_reference r where not exists (
        select 1 from jsonb_each(final_document) b,
            jsonb_array_elements_text(b.value->'references') target
        where b.key::bigint = r.source_bullet_id and target.value::bigint = r.target_bullet_id
    );
    delete from public.bullet_tag t where not exists (
        select 1 from jsonb_each(final_document) b, jsonb_array_elements_text(b.value->'tags') tag
        where b.key::bigint = t.bullet_id and tag.value = t.tag
    );
    delete from public.bullet b where not (final_document ? b.id::text);
    insert into public.bullet (id, body, parent_id, depth, sibling_order) overriding system value
    select key::bigint, value->>'body', (value->>'parent_id')::bigint,
        (value->>'depth')::integer, (value->>'sibling_order')::bigint from jsonb_each(final_document)
    on conflict (id) do update set body = excluded.body, parent_id = excluded.parent_id,
        depth = excluded.depth, sibling_order = excluded.sibling_order
    where (bullet.body, bullet.parent_id, bullet.depth, bullet.sibling_order)
        is distinct from (excluded.body, excluded.parent_id, excluded.depth, excluded.sibling_order);
    insert into public.bullet_reference (source_bullet_id, target_bullet_id)
    select b.key::bigint, target.value::bigint from jsonb_each(final_document) b,
        jsonb_array_elements_text(b.value->'references') target on conflict do nothing;
    insert into public.bullet_tag (bullet_id, tag)
    select b.key::bigint, tag.value from jsonb_each(final_document) b,
        jsonb_array_elements_text(b.value->'tags') tag on conflict do nothing;
    delete from public.bullet_draft where id = draft_id;
end;
$review$;
commit;
