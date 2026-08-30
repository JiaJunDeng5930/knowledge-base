begin;


-- 行级变更历史属于数据库运维数据，不属于当前知识模型。
-- Supabase 插件以 postgres 执行 SQL，因此该 schema 只隔离数据用途，
-- 不构成针对插件的权限边界。
create schema audit authorization postgres;

create table audit.row_change (
    id bigint generated always as identity primary key,
    changed_at timestamptz not null default pg_catalog.transaction_timestamp(),
    transaction_id xid8 not null,
    table_schema text not null,
    table_name text not null,
    operation text not null
        constraint row_change_operation_valid
        check (operation in ('INSERT', 'UPDATE', 'DELETE')),
    old_row jsonb,
    new_row jsonb,
    constraint row_change_snapshot_shape check (
        (operation = 'INSERT' and old_row is null and new_row is not null)
        or
        (operation = 'UPDATE' and old_row is not null and new_row is not null)
        or
        (operation = 'DELETE' and old_row is not null and new_row is null)
    )
);

create index row_change_transaction_idx
    on audit.row_change (transaction_id, id);


create function audit.record_row_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into audit.row_change (
        transaction_id,
        table_schema,
        table_name,
        operation,
        old_row,
        new_row
    ) values (
        pg_catalog.pg_current_xact_id(),
        tg_table_schema,
        tg_table_name,
        tg_op,
        case
            when tg_op in ('UPDATE', 'DELETE') then pg_catalog.to_jsonb(old)
        end,
        case
            when tg_op in ('INSERT', 'UPDATE') then pg_catalog.to_jsonb(new)
        end
    );

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;


create trigger knowledge_record_row_change
after insert or update or delete on public.knowledge_record
for each row execute function audit.record_row_change();

create trigger knowledge_reference_row_change
after insert or update or delete on public.knowledge_reference
for each row execute function audit.record_row_change();

create trigger record_tag_row_change
after insert or update or delete on public.record_tag
for each row execute function audit.record_row_change();

create trigger scheduler_config_row_change
after insert or update or delete on public.scheduler_config
for each row execute function audit.record_row_change();

create trigger fsrs_row_change
after insert or update or delete on public.fsrs
for each row execute function audit.record_row_change();

create trigger fsrs_knowledge_row_change
after insert or update or delete on public.fsrs_knowledge
for each row execute function audit.record_row_change();

create trigger fsrs_review_row_change
after insert or update or delete on public.fsrs_review
for each row execute function audit.record_row_change();


revoke all privileges on schema audit
from public, anon, authenticated, service_role;

revoke all privileges on all tables in schema audit
from public, anon, authenticated, service_role;

revoke all privileges on all sequences in schema audit
from public, anon, authenticated, service_role;

revoke execute on all functions in schema audit
from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema audit
    revoke all privileges on tables
    from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema audit
    revoke all privileges on sequences
    from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema audit
    revoke execute on functions
    from public, anon, authenticated, service_role;


commit;
