-- 参数：FSRS 对象 id 数组。返回原生 ReviewLog 数组。
select coalesce(
    jsonb_agg(
        jsonb_build_object(
            'card_id', fsrs_id,
            'rating', rating,
            'review_datetime', review_datetime,
            'review_duration', review_duration
        ) order by review_datetime, id
    ),
    '[]'::jsonb
) as review_logs
from public.fsrs_review
where fsrs_id = any($1::bigint[]);
