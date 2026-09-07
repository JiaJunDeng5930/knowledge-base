-- 没有草稿时创建；已有草稿时继续使用，不能覆盖原比较基准。
insert into public.bullet_draft (base, proposed)
select document, document from public.bullet_draft_source
on conflict (singleton) do nothing;
select id, updated_at, proposed from public.bullet_draft;
