-- 参数：fsrs_data.py review 的完整 JSON 输出。
-- 历史写入使用 UPDATE 实际命中的对象，使状态与历史在同一语句中保存。
with input as (
    select $1::jsonb as data
), updated as (
    update public.fsrs as fsrs
    set state = (input.data #>> '{card,state}')::smallint,
        step = (input.data #>> '{card,step}')::integer,
        stability_days = (input.data #>> '{card,stability}')::double precision,
        difficulty = (input.data #>> '{card,difficulty}')::double precision,
        due_at = (input.data #>> '{card,due}')::timestamptz,
        last_review_at = (input.data #>> '{card,last_review}')::timestamptz,
        revision = fsrs.revision + 1
    from input
    where fsrs.id = (input.data #>> '{card,card_id}')::bigint
      and fsrs.revision = (input.data ->> 'expected_revision')::bigint
      and fsrs.scheduler = input.data -> 'scheduler'
      and fsrs.id = (input.data #>> '{review_log,card_id}')::bigint
      and (input.data #>> '{card,last_review}')::timestamptz =
          (input.data #>> '{review_log,review_datetime}')::timestamptz
      and (
          fsrs.last_review_at is null
          or (input.data #>> '{review_log,review_datetime}')::timestamptz >= fsrs.last_review_at
      )
    returning fsrs.id, fsrs.revision
), logged as (
    insert into public.fsrs_review (fsrs_id, rating, review_datetime, review_duration)
    select updated.id,
           (input.data #>> '{review_log,rating}')::smallint,
           (input.data #>> '{review_log,review_datetime}')::timestamptz,
           (input.data #>> '{review_log,review_duration}')::bigint
    from updated
    cross join input
    returning fsrs_id
)
select updated.id, updated.revision
from updated
join logged on logged.fsrs_id = updated.id;
