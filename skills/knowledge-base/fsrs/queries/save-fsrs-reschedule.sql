-- 参数：包含 fsrs_data.py reschedule 输出的 card 与 scheduler_config_id 的 JSON。
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
    scheduler_config_id = (input.data ->> 'scheduler_config_id')::bigint
from input
where fsrs.id = (input.data #>> '{card,card_id}')::bigint
  and not (input.data ? 'review_log')
returning fsrs.id;
