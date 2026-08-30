-- 参数：包含 bullet_ids 与 scheduler_config_id 的 JSON；due_at 可选。
with input as (
    select $1::jsonb as data
), created as (
    insert into public.fsrs (scheduler_config_id, due_at)
    select (data ->> 'scheduler_config_id')::bigint,
           coalesce((data ->> 'due_at')::timestamptz, current_timestamp)
    from input
    where jsonb_array_length(data -> 'bullet_ids') > 0
    returning id
), linked as (
    insert into public.fsrs_bullet (fsrs_id, bullet_id)
    select distinct created.id, bullet_id.value::bigint
    from created
    cross join input
    cross join lateral jsonb_array_elements_text(input.data -> 'bullet_ids') as bullet_id(value)
    returning fsrs_id
)
select created.id
from created
where exists (select 1 from linked where linked.fsrs_id = created.id);
