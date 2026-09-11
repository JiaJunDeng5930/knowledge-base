-- 每日复习：读取截至当前时刻到期的一批 cue，包含逾期与到期的新对象。
-- $1 为 JSON；可选 root_bullet_id、excluded_fsrs_ids 和 limit。默认 {}。
-- root_bullet_id 限定关联知识的子树；一条 cue 即使关联多条命中知识也只返回一次。
with recursive input as (
    select
        ($1::jsonb ->> 'root_bullet_id')::bigint as root_bullet_id,
        coalesce($1::jsonb -> 'excluded_fsrs_ids', '[]'::jsonb) as excluded_fsrs_ids,
        greatest(1, least(100, coalesce(($1::jsonb ->> 'limit')::integer, 20))) as batch_limit
), scoped_bullets as (
    select bullet.id
    from public.bullet as bullet
    cross join input
    where bullet.id = input.root_bullet_id

    union all

    select child.id
    from public.bullet as child
    join scoped_bullets as parent on child.parent_id = parent.id
)
select fsrs.id::text as id, fsrs.cue, fsrs.due_at
from public.fsrs as fsrs
cross join input
where fsrs.due_at <= current_timestamp
  and not exists (
      select 1
      from jsonb_array_elements_text(input.excluded_fsrs_ids) as excluded(id)
      where excluded.id::bigint = fsrs.id
  )
  and (
      input.root_bullet_id is null
      or exists (
          select 1
          from public.fsrs_bullet as link
          join scoped_bullets as scope on scope.id = link.bullet_id
          where link.fsrs_id = fsrs.id
      )
  )
order by fsrs.due_at, fsrs.id
limit (select batch_limit from input);
