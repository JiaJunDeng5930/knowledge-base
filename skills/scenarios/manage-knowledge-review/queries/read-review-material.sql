-- $1 为 FSRS 对象 id。读取 cue、全部直接关联知识及其祖先上下文。
-- 引用返回目标 id；agent 按语义继续读取必要子树、引用和非文本材料。
-- JSON 中的 bigint id 使用字符串，避免传输时损失精度。
with recursive associated_bullets as (
    select bullet.id, bullet.parent_id
    from public.fsrs_bullet as link
    join public.bullet as bullet on bullet.id = link.bullet_id
    where link.fsrs_id = $1::bigint
), context_bullets as (
    select id, parent_id from associated_bullets

    union

    select parent.id, parent.parent_id
    from public.bullet as parent
    join context_bullets as child on child.parent_id = parent.id
)
select jsonb_build_object(
    'fsrs_id', fsrs.id::text,
    'cue', fsrs.cue,
    'associated_bullet_ids', (
        select coalesce(jsonb_agg(id::text order by id), '[]'::jsonb)
        from associated_bullets
    ),
    'bullets', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', bullet.id::text,
            'body', bullet.body,
            'parent_id', bullet.parent_id::text,
            'depth', bullet.depth,
            'sibling_order', bullet.sibling_order::text,
            'references', (
                select coalesce(jsonb_agg(reference.target_bullet_id::text
                    order by reference.target_bullet_id), '[]'::jsonb)
                from public.bullet_reference as reference
                where reference.source_bullet_id = bullet.id
            )
        ) order by bullet.depth, bullet.parent_id, bullet.sibling_order, bullet.id), '[]'::jsonb)
        from context_bullets as context
        join public.bullet as bullet on bullet.id = context.id
    )
) as material
from public.fsrs as fsrs
where fsrs.id = $1::bigint;
