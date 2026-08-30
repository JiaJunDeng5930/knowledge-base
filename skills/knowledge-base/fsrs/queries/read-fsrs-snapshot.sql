-- 参数：FSRS 对象 id。返回 Python 计算所需的完整 snapshot。
select jsonb_build_object(
    'scheduler_config_id', fsrs.scheduler_config_id,
    'scheduler', scheduler_config.scheduler,
    'card', jsonb_build_object(
        'card_id', fsrs.id,
        'state', fsrs.state,
        'step', fsrs.step,
        'stability', fsrs.stability_days,
        'difficulty', fsrs.difficulty,
        'due', fsrs.due_at,
        'last_review', fsrs.last_review_at
    )
) as snapshot
from public.fsrs
join public.scheduler_config
  on scheduler_config.id = fsrs.scheduler_config_id
where fsrs.id = $1::bigint;
