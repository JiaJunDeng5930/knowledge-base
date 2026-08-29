-- 参数：fsrs_data.py reschedule 的完整 JSON 输出。
with input as (
    select $1::jsonb as data
)
update public.fsrs as fsrs
set state = (input.data #>> '{card,state}')::smallint,
    step = (input.data #>> '{card,step}')::integer,
    stability_days = (input.data #>> '{card,stability}')::double precision,
    difficulty = (input.data #>> '{card,difficulty}')::double precision,
    due_at = (input.data #>> '{card,due}')::timestamptz,
    last_review_at = (input.data #>> '{card,last_review}')::timestamptz,
    scheduler = input.data -> 'scheduler',
    revision = fsrs.revision + 1
from input
where fsrs.id = (input.data #>> '{card,card_id}')::bigint
  and fsrs.revision = (input.data ->> 'expected_revision')::bigint
  and fsrs.last_review_at is not distinct from (input.data #>> '{card,last_review}')::timestamptz
  and not (input.data ? 'review_log')
returning fsrs.id, fsrs.revision;
