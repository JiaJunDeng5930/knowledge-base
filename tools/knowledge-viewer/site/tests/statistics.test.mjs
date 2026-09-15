import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALL_KNOWLEDGE, calendarDay, daysBetween, shiftDay, selectStatistics, contentDistribution, reviewCalendar, retrievability, memoryDistribution, reviewBacklog, memoryStages, frequentLapses, knowledgeTimeline } from '../features/statistics/statistics-model.ts';
import { fetchStatisticsHistory, parseStatisticsHistory } from '../features/statistics/statistics-history.ts';
import { readPanels, readingUrl, memoryCueTitle } from '../lib/reading-path.ts';

const empty = () => ({ bullets: [], references: [], effective_tags: [], scheduler_configs: [], fsrs: [], fsrs_bullet: [], fsrs_review: [], fetched_at: '2026-09-14T12:00:00Z' });
const bullet = (id, parent_id = null, body = '正文') => ({ id, parent_id, body, depth: parent_id ? 1 : 0, sibling_order: id });
const card = (id, overrides = {}) => ({ id, cue: '测试复习线索', scheduler_config_id: '1', state: 2, step: null, stability_days: 10, difficulty: 5, last_review_at: '2026-09-01T12:00:00Z', due_at: '2026-09-20T12:00:00Z', ...overrides });
const review = (id, fsrs_id, review_datetime, rating = 3) => ({ id, fsrs_id, review_datetime, rating, review_duration: null });
const projection = (id, parent_id = null, characters = 2) => ({ id, parent_id, characters });
const event = (id, at, before, after, table = 'bullet', changed = true) => ({ id, at, before, after, table, changed });
const now = Date.parse('2026-09-14T12:00:00Z');

test('年历固定从一月一日至十二月三十一日，闰年 366 天且不受夏令时影响', () => {
  assert.equal(calendarDay('2026-09-14T01:00:00Z', 'America/Los_Angeles'), '2026-09-13');
  assert.equal(calendarDay('2026-09-14T01:00:00Z', 'Asia/Shanghai'), '2026-09-14');
  assert.deepEqual(daysBetween('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  for (const date of ['2024-03-10', '2024-11-03', '2026-09-14']) {
    const year = date.slice(0, 4), count = year === '2024' ? 366 : 365;
    const rows = reviewCalendar([], [], Date.parse(date + 'T16:00:00Z'), 'America/Los_Angeles');
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map(row => row.day)).size, count);
    assert.equal(rows.at(-1).day, year + '-12-31');
    assert.equal(rows[0].day, year + '-01-01');
  }
  const boundary = Date.parse('2026-01-01T01:00:00Z');
  assert.equal(reviewCalendar([], [], boundary, 'America/Los_Angeles')[0].day, '2025-01-01');
  assert.equal(reviewCalendar([], [], boundary, 'Asia/Shanghai')[0].day, '2026-01-01');
});

test('FSRS 多对多关联去重，目录和有效标签取交集，字符按码点计数', () => {
  const snapshot = empty();
  snapshot.bullets = [bullet('9007199254740993'), bullet('2', '9007199254740993', '😀甲'), bullet('3'), bullet('4', '3')];
  snapshot.effective_tags = [{ bullet_id: '9007199254740993', tag: '测试' }];
  snapshot.fsrs = [card('1'), card('2')];
  snapshot.fsrs_bullet = [{ fsrs_id: '1', bullet_id: '9007199254740993' }, { fsrs_id: '1', bullet_id: '2' }, { fsrs_id: '2', bullet_id: '4' }];
  snapshot.references = [{ source_bullet_id: '2', target_bullet_id: '4' }];
  const selected = selectStatistics(snapshot, { rootId: '9007199254740993', tag: '测试' });
  assert.equal(selected.bullets.length, 2);
  assert.equal(selected.fsrs.length, 1);
  assert.equal(selected.coveredIds.size, 2);
  assert.equal(selected.characters, 4);
  assert.equal(selected.references.length, 1);
  assert.equal(selectStatistics(snapshot, { rootId: '3', tag: '测试' }).bullets.length, 0);
  assert.equal(selectStatistics(snapshot, { rootId: 'missing', tag: null }).fsrs.length, 0);
});

test('内容分布按直接下级聚合，叶节点钻取不会跳回根目录', () => {
  const snapshot = empty();
  snapshot.bullets = [bullet('1'), bullet('2', '1'), bullet('3', '2'), bullet('4', '1')];
  assert.deepEqual(contentDistribution(snapshot, { rootId: '1', tag: null }).map(row => [row.bullet.id, row.count]), [['2', 2], ['4', 1]]);
  assert.deepEqual(contentDistribution(snapshot, { rootId: '3', tag: null }).map(row => row.bullet.id), ['3']);
});

test('日历计全部评分，真实保留率排除首次、短期重复及未来事件', () => {
  const reviews = [
    review('1', '1', '2026-09-10T10:00:00Z'),
    review('2', '1', '2026-09-11T11:00:00Z', 1),
    review('3', '1', '2026-09-11T11:05:00Z', 3),
    review('4', '2', '2026-09-10T11:00:00Z'),
    review('5', '2', '2026-09-11T11:00:00Z', 2),
    review('6', '3', '2026-09-11T11:00:00Z', 4),
    review('7', '2', '2026-09-14T14:00:00Z', 1),
  ];
  const days = reviewCalendar(reviews, [], now, 'UTC');
  const day = days.find(day => day.day === '2026-09-11');
  assert.equal(day.count, 4);
  assert.equal(day.objectIds.length, 3);
  assert.deepEqual(day.ratings, [1, 1, 1, 1]);
  assert.equal(day.tested, 2);
  assert.equal(day.recalled, 1);
  assert.equal(day.retention, 0.5);
  assert.deepEqual(day.retentionReviewIds, ['2', '5']);
  assert.equal(days.find(day => day.day === '2026-09-10').retention, null);
  assert.equal(days.at(-1).count, 0);
});

test('上一年的复习仍参与一月一日的间隔判断', () => {
  const start = '2026-01-01';
  const rows = reviewCalendar([review('1', '1', shiftDay(start, -1) + 'T00:00:00Z'), review('2', '1', start + 'T00:00:00Z')], [], now, 'UTC');
  assert.equal(rows[0].tested, 1);
  assert.equal(rows[0].retention, 1);
});

test('FSRS-6 可提取性遵守 py-fsrs 的整天边界，并保留未知状态', () => {
  const scheduler = { parameters: Array.from({ length: 21 }, (_, index) => index === 20 ? 0.1542 : 1) };
  const memory = card('1', { stability_days: 2, last_review_at: '2026-09-12T12:00:00Z' });
  assert.ok(Math.abs(retrievability(memory, scheduler, now) - 0.9) < 1e-12);
  assert.equal(retrievability(memory, scheduler, Date.parse('2026-09-13T11:59:59Z')), 1);
  assert.equal(retrievability(card('2', { last_review_at: null, stability_days: null }), scheduler, now), null);
  assert.equal(retrievability(memory, { parameters: [] }, now), null);
  const distribution = memoryDistribution([memory, card('2', { last_review_at: null, stability_days: null })], [{ id: '1', scheduler }], 'retrievability', now);
  assert.equal(distribution.measured, 1);
  assert.equal(distribution.unmeasured, 1);
  assert.equal(distribution.bins.at(-1).count, 1);
  assert.equal(distribution.bins.at(-1).cumulative, 1);
});

test('直方图区间不丢失边界值、最大难度或一年以上的间隔', () => {
  const result = memoryDistribution([card('1', { difficulty: 1 }), card('2', { difficulty: 2 }), card('3', { difficulty: 10 })], [], 'difficulty', now);
  assert.equal(result.bins[0].count, 1);
  assert.equal(result.bins[1].count, 1);
  assert.equal(result.bins.at(-1).count, 1);
  assert.equal(result.median, 2);
  assert.equal(memoryDistribution([card('1', { stability_days: 400 })], [], 'stability', now).bins.at(-1).count, 1);
});

test('此前到期与年历安排互斥；今天保留已完成和待复习，远期安排可按年份查看', () => {
  const cards = [
    card('1', { due_at: '2026-09-14T11:00:00Z' }),
    card('2', { last_review_at: null, stability_days: null, due_at: '2026-09-01T00:00:00Z' }),
    card('3', { due_at: '2026-09-14T13:00:00Z' }),
    card('4', { due_at: '2028-01-01T00:00:00Z' }),
    card('5', { due_at: '2026-09-13T23:00:00Z' }),
    card('6', { due_at: '2026-12-31T23:59:59Z', last_review_at: null }),
  ];
  const reviews = [review('1', '1', '2026-09-14T10:00:00Z')];
  const backlog = reviewBacklog(cards, now, 'UTC');
  const days = reviewCalendar(reviews, cards, now, 'UTC', 2026);
  const today = days.find(day => day.day === '2026-09-14');
  assert.deepEqual(backlog.ids, ['5']);
  assert.deepEqual(backlog.newIds, ['2']);
  assert.equal(today.count, 1);
  assert.deepEqual(today.pendingIds, ['1', '3']);
  assert.ok(days.filter(day => day.day < today.day).every(day => !day.pendingIds.length));
  assert.deepEqual(days.at(-1).firstReviewIds, ['6']);
  const future = reviewCalendar(reviews, cards, now, 'UTC', 2028);
  assert.deepEqual(future[0].pendingIds, ['4']);
  assert.equal(future.length, 366);
  assert.ok(future.every(day => !day.count && day.retention === null));
  const ids = [...backlog.ids, ...backlog.newIds, ...days.flatMap(day => day.pendingIds), ...future.flatMap(day => day.pendingIds)];
  assert.equal(ids.length, cards.length);
  assert.equal(new Set(ids).size, cards.length);
});

test('选择历史年份读取全年实际记录，跨年到期按用户时区分组', () => {
  const reviews = [review('1', '1', '2024-02-29T00:00:00Z'), review('2', '1', '2024-12-31T23:30:00Z'), review('3', '1', '2026-09-14T13:00:00Z')];
  const past = reviewCalendar(reviews, [], now, 'UTC', 2024);
  assert.equal(past.reduce((count, day) => count + day.count, 0), 2);
  assert.deepEqual(past.find(day => day.day === '2024-02-29').reviewIds, ['1']);
  assert.deepEqual(past.at(-1).reviewIds, ['2']);
  const cards = [card('1', { due_at: '2026-12-31T23:30:00Z' })];
  assert.deepEqual(reviewCalendar([], cards, now, 'Asia/Shanghai', 2027)[0].pendingIds, ['1']);
  assert.equal(reviewCalendar([], cards, now, 'Asia/Shanghai', 2026).at(-1).pendingIds.length, 0);
  const moved = reviewCalendar([], [card('1', { due_at: '2027-01-03T00:00:00Z' })], now, 'Asia/Shanghai', 2027);
  assert.equal(moved[0].pendingIds.length, 0);
  assert.deepEqual(moved[2].pendingIds, ['1']);
});

test('阶段划分互斥且穷尽，尚未复习不混入学习中', () => {
  const stages = memoryStages([card('1', { state: 1, last_review_at: null }), card('2', { state: 1 }), card('3'), card('4', { state: 3 })]);
  assert.deepEqual(stages.map(stage => stage.ids), [['1'], ['2'], ['3'], ['4']]);
  assert.equal(frequentLapses([card('1')], [review('1', '1', '2026-09-01T00:00:00Z', 1), review('2', '1', '2026-09-20T00:00:00Z', 1)], now).length, 0);
});

test('历史从数据库当前投影逆向重建，包括删除、同日多次修改、空白日与大整数身份', () => {
  const history = { observed_at: '2026-09-14T12:00:00Z', coverage_start: '2026-09-10T00:00:00Z', bullets: [projection('1', null, 7)], tags: [], events: [
    event('9007199254740993', '2026-09-10T10:00:00Z', null, projection('1', null, 2)),
    event('9007199254740994', '2026-09-11T10:00:00Z', projection('1', null, 2), projection('1', null, 5)),
    event('9007199254740995', '2026-09-11T10:00:00Z', projection('1', null, 5), projection('1', null, 7)),
    event('9007199254740996', '2026-09-12T10:00:00Z', null, projection('2')),
    event('9007199254740997', '2026-09-13T10:00:00Z', projection('2'), null),
  ] };
  const days = knowledgeTimeline(history, ALL_KNOWLEDGE, 'UTC');
  assert.deepEqual(days.map(day => day.total), [1, 1, 2, 1, 1]);
  assert.deepEqual(days.map(day => day.characters), [2, 7, 9, 7, 7]);
  assert.equal(days[1].modified, 1);
  assert.deepEqual(days[3].removedIds, ['2']);
  assert.equal(days.at(-1).added + days.at(-1).modified + days.at(-1).removed, 0);
  assert.deepEqual(knowledgeTimeline({ ...history, coverage_start: null }, ALL_KNOWLEDGE, 'UTC'), []);
});

test('历史按当时父关系与继承标签筛选；移出目录的节点不会从过去消失', () => {
  const history = { observed_at: '2026-09-14T12:00:00Z', coverage_start: '2026-09-10T00:00:00Z', bullets: [projection('1'), projection('2'), projection('3', '2')], tags: [], events: [
    event('1', '2026-09-10T10:00:00Z', null, { bullet_id: '1', tag: 'working' }, 'bullet_tag'),
    event('2', '2026-09-11T10:00:00Z', projection('3', '1'), projection('3', '2')),
    event('3', '2026-09-12T10:00:00Z', { bullet_id: '1', tag: 'working' }, null, 'bullet_tag'),
  ] };
  assert.deepEqual(knowledgeTimeline(history, { rootId: '1', tag: null }, 'UTC').map(day => day.total), [2, 1, 1, 1, 1]);
  assert.deepEqual(knowledgeTimeline(history, { rootId: null, tag: 'working' }, 'UTC').map(day => day.total), [2, 1, 0, 0, 0]);
});

test('历史传输固定端点、服务端凭据与失败语义；格式错误不会显示成零', async () => {
  const value = { observed_at: '2026-09-14T12:00:00Z', coverage_start: null, bullets: [], tags: [], events: [] };
  const result = await fetchStatisticsHistory('https://example.test', 'sb_publishable_test', 'private_test_key', async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/read_knowledge_statistics_history');
    assert.equal(options.headers['x-bullet-draft-key'], 'private_test_key');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.cache, 'no-store');
    return Response.json(value);
  });
  assert.deepEqual(result, value);
  assert.throws(() => parseStatisticsHistory({ ...value, bullets: [projection(9007199254740992)] }), /invalid response/);
  await assert.rejects(fetchStatisticsHistory('http://example.test', 'key', 'reader'), /requires HTTPS/);
  await assert.rejects(fetchStatisticsHistory('https://example.test', 'key', 'reader', async () => new Response('private upstream content', { status: 403 })), /upstream unavailable/);
});

test('统计路径可恢复，cue 标题沿用阅读器规则', () => {
  const panels = [{ kind: 'statistics' }, { kind: 'fsrs', id: '9007199254740993' }];
  assert.deepEqual(readPanels(new URL(readingUrl(panels), 'https://example.test')), panels);
  assert.equal(memoryCueTitle('场景等价类：判断函数指针是否可复制'), '判断函数指针是否可复制');
});

test('历史接口在读取 audit 之前校验专用凭据，并且不开放原始审计表', async () => {
  const sql = await readFile(new URL('../features/statistics/history.sql', import.meta.url), 'utf8');
  assert.ok(sql.indexOf('perform public.bullet_draft_reader_authorized()') < sql.indexOf('select jsonb_build_object'));
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function public\.read_knowledge_statistics_history\(\) from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant\s+(?:all|select|usage).*audit/i);
});
