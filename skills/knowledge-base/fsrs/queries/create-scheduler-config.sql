-- 参数：完整的原生 Scheduler 配置 JSON。
insert into public.scheduler_config (scheduler)
values ($1::jsonb)
returning id;
