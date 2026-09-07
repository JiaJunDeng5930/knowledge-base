import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// 直接渲染真实阅读组件，检查展示契约；不把此检查称为浏览器交互测试。
const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(new URL('../components/knowledge-reader.tsx', import.meta.url), 'utf8');
const output = buildSync({
  stdin: {contents: source + '\nexport {BulletPage, BulletListPage, IndexPage, MemoryListPage, MemoryPage, ReadingHeader, ReaderNavigation, ReadingViewProvider, SidebarProvider, buildKnowledgeModel};\nexport {buildPageBlocks, buildReferenceSections, blockExpansionKey} from "@/components/reader-presentation/page-content/model";', loader: 'tsx', resolveDir: root + 'components'},
  absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false, logLevel: 'silent',
}).outputFiles[0].text;
// 与正式构建保持 ESM 语义，避免外部 Markdown 依赖在 CJS 中的默认导出歧义。
const bundleDir = mkdtempSync(root + 'node_modules/.reading-content-');
let components;
try {
  const bundlePath = bundleDir + '/components.mjs';
  writeFileSync(bundlePath, output);
  components = await import(pathToFileURL(bundlePath).href);
} finally {
  rmSync(bundleDir, {recursive: true, force: true});
}
const {BulletPage, BulletListPage, IndexPage, MemoryListPage, MemoryPage, ReadingHeader, ReaderNavigation, ReadingViewProvider, SidebarProvider, buildKnowledgeModel, buildPageBlocks, buildReferenceSections, blockExpansionKey} = components;
const bullet = (id, body, parent_id, depth) => ({id, body, parent_id, depth, sibling_order: id});
const sentence = '调用位置与使用上下文一起约束类型，不能把这个完整事实截成一个标题。';
const cue = '场景等价类（源码解释）：区分函数调用与宏调用。\n具体理解：函数传入实参，宏处理记号树。';
const snapshot = {
  bullets: [bullet('1','knowledge',null,0),bullet('2','Rust','1',1),bullet('3','函数调用','2',2),bullet('4',sentence,'3',3),bullet('5','```rust\nlet foo_bar: *const T;\n```','4',4)],
  references: [], effective_tags: [], scheduler_configs: [{id:'1',scheduler:{desired_retention:.9,maximum_interval:36500,enable_fuzzing:true,learning_steps:[60],relearning_steps:[],parameters:[]}}],
  fsrs: [{id:'10',cue,scheduler_config_id:'1',state:1,step:0,stability_days:null,difficulty:null,last_review_at:null,due_at:'2026-09-01T12:00:00Z'}],
  fsrs_bullet: [{fsrs_id:'10',bullet_id:'3'},{fsrs_id:'10',bullet_id:'4'}], fsrs_review: [], fetched_at:'2026-09-06T12:00:00Z',
};
const model = buildKnowledgeModel(snapshot);
const view = patch => ({scrollTop:0,expanded:{},raw:false,query:'',limit:60,memoryFilter:'all',historyLimit:30,focusedId:null,highlight:'',matchIndex:0,details:{},...patch});
function render(Component, props, cached) {
  return renderToStaticMarkup(React.createElement(SidebarProvider,{},React.createElement(ReadingViewProvider,{viewKey:'test-path',cache:new Map(cached ? [['test-path',cached]] : [])},React.createElement(Component,{model,from:0,navigate(){},now:Date.parse(snapshot.fetched_at),...props}))));
}

test('真实正文组件连续展示深层事实与代码，不渲染空关系面板', () => {
  const html = render(BulletPage,{panel:{kind:'bullet',id:'3'}});
  assert.ok(html.includes(sentence));
  assert.match(html,/let foo_bar: \*const T;/);
  assert.match(html,/data-bullet-id="5"/);
  assert.match(html,/本篇目录/);
  assert.doesNotMatch(html,/暂无引用|暂无反向引用/);
  const prose = render(BulletPage,{panel:{kind:'bullet',id:'4'}});
  assert.doesNotMatch(prose,/<h1 class="note-title">/);
  assert.match(prose,/<p>调用位置与使用上下文一起约束类型/);
});

test('缓存的展开、筛选和高亮直接驱动重访页面，不从默认值重建', () => {
  const folded = render(BulletPage,{panel:{kind:'bullet',id:'3'}},view({expanded:{'4':false}}));
  assert.doesNotMatch(folded,/data-bullet-id="5"/);
  assert.match(folded,/aria-label="展开下级：/);
  assert.match(folded,/data-collapsed="true"/);
  assert.doesNotMatch(folded,/collapsed-count/);
  const filtered = render(BulletListPage,{},view({query:'foo_bar'}));
  assert.match(filtered,/1 条匹配/);
  assert.match(filtered,/title="在父级中定位此笔记"/);
  assert.match(filtered,/focus|%40/);
  const highlighted = render(BulletPage,{panel:{kind:'bullet',id:'4'}},view({highlight:'使用上下文'}));
  assert.match(highlighted,/<mark data-knowledge-match="true">使用上下文<\/mark>/);
});

test('记忆页面保留完整 cue、多条关联与按需查看的调度信息', () => {
  const html = render(MemoryPage,{id:'10'});
  assert.match(html,/函数传入实参，宏处理记号树/);
  assert.ok(html.includes(sentence));
  assert.match(html,/函数调用/);
  assert.match(html,/记忆状态/);
  assert.match(html,/复习历史/);
  assert.match(html,/调度配置/);
});

test('每个内容块只由圆点独立打开，三角只负责展开下级', () => {
  const html = render(BulletPage,{panel:{kind:'bullet',id:'2'}});
  for (const [id,next] of [['3','4'],['4','5']]) {
    const row = html.slice(html.indexOf('data-bullet-id="'+id+'"'), html.indexOf('data-bullet-id="'+next+'"'));
    assert.equal((row.match(/class="page-link page-link--bullet"/g)||[]).length,1);
    assert.match(row,/class="page-block-toggle" aria-expanded="true"/);
    assert.match(row,/title="在后文打开此内容"/);
    assert.doesNotMatch(row,/branch-title|branch-open/);
  }
  assert.doesNotMatch(html,/parent-context|在上下文中看|reading-section-controls/);
});

test('全局搜索只有一个入口，路径切换与设置保留可访问名称', () => {
  const noop=()=>{};
  const props={model,panels:[{kind:'index'},{kind:'bullet',id:'3'}],active:1,navigate:noop,activate:noop,search:noop,font:{min:16,max:24,defaultSize:17},size:17,changeSize:noop,focused:false,setFocused:noop,copy:noop,copied:false,refresh:noop,refreshing:false,error:null,help:noop};
  const html = renderToStaticMarkup(React.createElement(SidebarProvider,{},React.createElement(React.Fragment,{},React.createElement(ReaderNavigation,props),React.createElement(ReadingHeader,props))));
  assert.equal((html.match(/aria-label="搜索知识库/g)||[]).length,1);
  assert.equal((html.match(/class="reader-home"/g)||[]).length,1);
  assert.match(html,/aria-label="阅读设置"/);
  assert.match(html,/aria-label="选择已打开的笔记"/);
  assert.doesNotMatch(html,/reading-footer|sheet-toolbar|reading-trail|search-launch/);
});

const fullReference = '# 借用规则\n\n[函数调用](/bullet/3)与[说明](https://example.com/guide)相关。\n\n' + '完整原文不能被摘要截断。'.repeat(35) + '\n\n末段也必须保留。';
const relationModel = buildKnowledgeModel({...snapshot,
  bullets: [...snapshot.bullets,bullet('6',fullReference,'2',2),bullet('7','引用的下级原文。','6',3),bullet('8','环中的第一块','9',4),bullet('9','环中的第二块','8',4)],
  references: [
    {source_bullet_id:'3',target_bullet_id:'6'}, {source_bullet_id:'3',target_bullet_id:'6'},
    {source_bullet_id:'4',target_bullet_id:'3'}, {source_bullet_id:'6',target_bullet_id:'3'},
    {source_bullet_id:'99',target_bullet_id:'3'}, {source_bullet_id:'3',target_bullet_id:'8'},
    {source_bullet_id:'5',target_bullet_id:'4'},
  ],
});

test('引用模型保留方向与父级上下文，去重并终止损坏数据中的循环', () => {
  const sections = buildReferenceSections(relationModel,'3');
  assert.deepEqual(sections.map(section=>section.direction),['outgoing','incoming']);
  const outgoing = sections[0].groups.flatMap(group=>group.blocks);
  assert.deepEqual(outgoing.map(block=>block.id),['6','8']);
  assert.deepEqual(sections[0].groups[0].context.map(part=>part.id),['1','2']);
  assert.deepEqual(sections[1].groups.flatMap(group=>group.blocks).map(block=>block.id),['4','6','99']);
  assert.equal(outgoing[1].children[0].id,'9');
  assert.equal(outgoing[1].children[0].children.length,0);
  assert.equal(sections[1].groups.at(-1).blocks[0].available,false);
  assert.equal(buildPageBlocks(relationModel,'3')[0].id,'4');
});

test('引用呈现完整原文与原位置链接，空引用不出现摘要卡片', () => {
  const html = render(BulletPage,{panel:{kind:'bullet',id:'3'},model:relationModel});
  const references = html.slice(html.indexOf('class="note-relations"'));
  assert.match(references,/引用本条内容的原文/);
  assert.match(references,/本条内容引用的原文/);
  assert.match(references,/末段也必须保留。/);
  assert.match(references,/内容 #99 暂不可用/);
  assert.match(references,/title="在「Rust」中定位原文"/);
  assert.match(references,/href="\/\?p=b%3A2%406"/);
  assert.match(references,/class="page-link page-link--inline" href="\/\?p=b%3A3"/);
  assert.match(references,/class="page-external-link"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
  assert.doesNotMatch(references,/data-bullet-id=|data-reference-bullet-id="7"|reference-group.*<h2>.*<span>\d/);
});

test('同一块的正文、两个引用实例独立折叠，引用不参与页内搜索定位', () => {
  const key = blockExpansionKey({kind:'reference',key:'incoming:1/2/3'},'4');
  const html = render(BulletPage,{panel:{kind:'bullet',id:'3'},model:relationModel},view({expanded:{'4':false},highlight:'使用上下文',details:{[key]:true,'reference-block:incoming:1/2:6':true,'references:outgoing':false}}));
  assert.doesNotMatch(html,/data-bullet-id="5"/);
  assert.match(html,/data-reference-bullet-id="5"/);
  assert.equal((html.match(/data-knowledge-match="true"/g)||[]).length,1);
  assert.equal((html.match(/data-reference-bullet-id="7"/g)||[]).length,1);
  const sections = [...html.matchAll(/<details class="page-reference-section"([^>]*)>/g)];
  assert.doesNotMatch(sections[0][1],/open/);
  assert.match(sections[1][1],/open/);
  assert.notEqual(key,blockExpansionKey({kind:'body'},'4'));
  assert.notEqual(key,blockExpansionKey({kind:'reference',key:'outgoing:1/2/3'},'4'));
});

test('首页、正文和列表不再显示笔记、记忆对象总数或字符统计', () => {
  const html = render(IndexPage,{})+render(BulletPage,{panel:{kind:'bullet',id:'3'}})+render(BulletListPage,{})+render(MemoryListPage,{});
  assert.doesNotMatch(html,/\d+\s*(条笔记|个记忆对象|个对象|字符|条关联笔记|条内容)/);
  assert.doesNotMatch(html,/index-counts|relation-count/);
  assert.match(render(BulletListPage,{},view({query:'foo_bar'})),/1 条匹配/);
});
