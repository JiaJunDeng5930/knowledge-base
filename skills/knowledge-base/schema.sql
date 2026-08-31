begin;


-- ============================================================
-- 1. 子弹笔记
--
-- 知识模型使用有序森林保存子弹笔记。
--
-- 历史版本、diff、批注和原始交互记录不属于当前知识模型，
-- 因此不进入这张表。
-- ============================================================

create table public.bullet (
    -- 稳定身份用于子弹笔记结构、bullet 引用、标签和 FSRS 关联。
    id bigint generated always as identity primary key,

    -- bullet 的正文。
    body text not null,

    -- 当前 bullet 的直接父 bullet。
    -- NULL 表示根 bullet。
    parent_id bigint,

    -- depth 不属于知识内容。
    --
    -- 它只用于让普通表约束直接保证 parent_id 形成无环森林，
    -- 从而不依赖写入前递归检查或 trigger。
    depth integer not null
        constraint bullet_depth_nonnegative
        check (depth >= 0),

    -- 子 bullet 通过这个生成值引用 depth 恰好小 1 的父 bullet。
    -- 应用只写 depth，不单独维护 parent_depth。
    parent_depth integer
        generated always as (depth - 1) stored,

    -- 同一父 bullet 的子 bullet 具有确定的线性顺序。
    -- 数值只承担排序作用，不要求连续。
    sibling_order bigint not null,

    -- 根 bullet 的 depth 为 0。
    -- 非根 bullet 的 depth 大于 0。
    constraint bullet_root_shape
        check (
            (parent_id is null and depth = 0)
            or
            (parent_id is not null and depth > 0)
        ),

    -- PostgreSQL 的复合外键要求目标列组具有唯一约束。
    -- id 本身仍然是 bullet 的实际身份。
    constraint bullet_id_depth_key
        unique (id, depth),

    -- 如果 P 是 N 的父 bullet，则 P.depth = N.depth - 1。
    --
    -- 沿 parent_id 向上移动时，depth 必须持续下降，
    -- 最终到达 depth = 0 的根 bullet，因此环无法满足这个约束。
    constraint bullet_parent_fk
        foreign key (parent_id, parent_depth)
        references public.bullet (id, depth)
        deferrable initially deferred,

    -- 同一父 bullet 下不能出现两个相同的 sibling_order。
    --
    -- NULLS NOT DISTINCT 使 parent_id 为 NULL 的全部根 bullet
    -- 也构成一个有序集合。
    constraint bullet_sibling_order_key
        unique nulls not distinct (parent_id, sibling_order)
        deferrable initially deferred
);


-- ============================================================
-- 2. bullet 引用
--
-- 引用用于让 LLM 从当前 bullet 拉起其他相关 bullet 并继续探索。
--
-- 引用不保存正文中的精确位置，也不保存关系类型。
-- 具体相关性继续由知识文本表达并由 LLM 解释。
-- ============================================================

create table public.bullet_reference (
    -- 发出引用的 bullet。
    source_bullet_id bigint not null
        references public.bullet (id),

    -- 被引用的 bullet。
    target_bullet_id bigint not null
        references public.bullet (id),

    -- 同一来源和目标之间只保存一条 bullet 引用。
    primary key (source_bullet_id, target_bullet_id)
);


-- 主键索引已经适合从 source_bullet_id 查询它引用的全部 bullet。
--
-- 这个反向索引适合从 target_bullet_id 查询全部反向 bullet 引用。
create index bullet_reference_target_idx
    on public.bullet_reference (
        target_bullet_id,
        source_bullet_id
    );


-- ============================================================
-- 3. 标签
--
-- 标签直接附着在 bullet 上。
-- 一个节点拥有的标签同时对它的全部后代生效。
--
-- working text 不再是独立实体。
-- 给某个节点添加 working 标签后，该节点的整棵子树都可以作为
-- working 内容查询。
-- ============================================================

create table public.bullet_tag (
    -- 被直接打标签的 bullet。
    bullet_id bigint not null
        references public.bullet (id),

    -- 标签本身只需要一个名称。
    -- 当前模型没有要求标签拥有其他独立属性。
    tag text not null,

    -- 同一 bullet 不能重复拥有同一个直接标签。
    primary key (bullet_id, tag)
);


-- 主键索引适合查询一个 bullet 直接拥有的标签。
--
-- 这个索引适合从标签查询直接被标记的 bullet，
-- 也是查询某个标签整片子树的入口。
create index bullet_tag_tag_idx
    on public.bullet_tag (
        tag,
        bullet_id
    );


-- 这里只持久化直接标签。
-- 有效标签通过森林结构实时得到，不给每个后代复制一份标签。
create view public.effective_bullet_tag
with (security_invoker = true) as
with recursive inherited_tag (bullet_id, tag) as (
    -- 直接标签首先对 bullet 自身生效。
    select
        bullet_id,
        tag
    from public.bullet_tag

    union

    -- 一条有效标签继续传递给当前 bullet 的直接孩子，
    -- 递归后自然覆盖全部子孙节点。
    select
        child.id,
        inherited_tag.tag
    from inherited_tag
    join public.bullet as child
      on child.parent_id = inherited_tag.bullet_id
)
select
    bullet_id,
    tag
from inherited_tag;


-- ============================================================
-- 4. Scheduler 配置
--
-- scheduler 保存 Scheduler.to_dict() 的完整配置。
-- 多个 FSRS 对象可以引用同一条配置。
-- ============================================================

create table public.scheduler_config (
    id bigint generated always as identity primary key,
    scheduler jsonb not null,
    constraint scheduler_config_scheduler_shape check (
        jsonb_typeof(scheduler) = 'object'
        and scheduler ?& array[
            'parameters', 'desired_retention', 'learning_steps',
            'relearning_steps', 'maximum_interval', 'enable_fuzzing'
        ]
        and jsonb_typeof(scheduler -> 'parameters') = 'array'
        and jsonb_array_length(scheduler -> 'parameters') = 21
        and jsonb_typeof(scheduler -> 'learning_steps') = 'array'
        and jsonb_typeof(scheduler -> 'relearning_steps') = 'array'
        and jsonb_typeof(scheduler -> 'desired_retention') = 'number'
        and (scheduler ->> 'desired_retention')::double precision > 0
        and (scheduler ->> 'desired_retention')::double precision <= 1
        and jsonb_typeof(scheduler -> 'maximum_interval') = 'number'
        and (scheduler ->> 'maximum_interval')::integer > 0
        and jsonb_typeof(scheduler -> 'enable_fuzzing') = 'boolean'
    )
);

-- ============================================================
-- 5. FSRS-6 对象
--
-- cue 保存该对象调度的场景等价类及学习者需要恢复的具体理解。
-- 字段对应 py-fsrs Card；scheduler_config_id 指向该对象使用的配置。
-- 尚未复习的对象具有有效的阶段与到期时间，记忆状态及最后复习时间为空。
-- ============================================================

create table public.fsrs (
    id bigint generated always as identity primary key,
    cue text not null
        constraint fsrs_cue_nonempty
        check (btrim(cue) <> ''),
    scheduler_config_id bigint not null references public.scheduler_config (id),
    state smallint not null default 1
        check (state in (1, 2, 3)),
    step integer default 0,
    stability_days double precision
        check (stability_days > 0 and stability_days < 'Infinity'::double precision),
    difficulty double precision
        check (difficulty between 1.0 and 10.0),
    last_review_at timestamptz
        check (isfinite(last_review_at)),
    due_at timestamptz not null default current_timestamp
        check (isfinite(due_at) and due_at >= last_review_at),
    constraint fsrs_step_valid check (
        (state = 2 and step is null)
        or (state in (1, 3) and step is not null and step >= 0)
    ),
    constraint fsrs_memory_state_complete check (
        (stability_days is null and difficulty is null and last_review_at is null)
        or
        (stability_days is not null and difficulty is not null and last_review_at is not null)
    )
);

create index fsrs_due_idx on public.fsrs (due_at);
create index fsrs_scheduler_config_idx on public.fsrs (scheduler_config_id);

-- ============================================================
-- 6. FSRS 对象与 bullet 的多对多关联
-- ============================================================

create table public.fsrs_bullet (
    fsrs_id bigint not null references public.fsrs (id),
    bullet_id bigint not null references public.bullet (id),
    primary key (fsrs_id, bullet_id)
);

create index fsrs_bullet_idx
    on public.fsrs_bullet (bullet_id, fsrs_id);

-- ============================================================
-- 7. 复习历史
--
-- 每行保存一次实际复习产生的 ReviewLog，供参数拟合和状态重算使用。
-- 状态重算不产生新的复习观测；历史不通过当前状态的数值变化推测。
-- ============================================================

create table public.fsrs_review (
    id bigint generated always as identity primary key,
    fsrs_id bigint not null references public.fsrs (id),
    rating smallint not null check (rating between 1 and 4),
    review_datetime timestamptz not null check (isfinite(review_datetime)),
    review_duration bigint check (review_duration >= 0)
);

create index fsrs_review_object_time_idx
    on public.fsrs_review (fsrs_id, review_datetime, id);

-- Data API 使用 publishable key 读取知识快照；写入仍通过已授权的 SQL 通道。
-- anon 角色只获得 SELECT 策略，不能通过 Data API 修改知识库。
alter table public.bullet enable row level security;
alter table public.bullet_reference enable row level security;
alter table public.bullet_tag enable row level security;
alter table public.scheduler_config enable row level security;
alter table public.fsrs enable row level security;
alter table public.fsrs_bullet enable row level security;
alter table public.fsrs_review enable row level security;

create policy bullet_anon_select
    on public.bullet for select to anon using (true);
create policy bullet_reference_anon_select
    on public.bullet_reference for select to anon using (true);
create policy bullet_tag_anon_select
    on public.bullet_tag for select to anon using (true);
create policy scheduler_config_anon_select
    on public.scheduler_config for select to anon using (true);
create policy fsrs_anon_select
    on public.fsrs for select to anon using (true);
create policy fsrs_bullet_anon_select
    on public.fsrs_bullet for select to anon using (true);
create policy fsrs_review_anon_select
    on public.fsrs_review for select to anon using (true);


commit;
