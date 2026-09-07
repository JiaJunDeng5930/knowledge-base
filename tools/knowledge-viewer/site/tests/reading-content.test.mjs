import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// 直接渲染真实阅读组件，检查展示契约；不把此检查称为浏览器交互测试。
const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(new URL('../components/knowledge-reader.tsx', import.meta.url), 'utf8');
const output = buildSync({
  stdin: {contents: source + '\nexport {BulletPage, BulletListPage, MemoryPage, ReadingHeader, ReaderNavigation, ReadingViewProvider, SidebarProvider, buildKnowledgeModel};', loader: 'tsx', resolveDir: root + 'components'},
  absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
}).outputFiles[0].text;
const module = {exports: {}};
new Function('require', 'module', 'exports', output)(createRequire(import.meta.url), module, module.exports);
const {BulletPage, BulletListPage, MemoryPage, ReadingHeader, ReaderNavigation, ReadingViewProvider, SidebarProvider, buildKnowledgeModel} = module.exports;
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
  assert.match(folded,/<span class="collapsed-count" aria-hidden="true">… 1<\/span>/);
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

test('标题链接与独立打开箭头择一出现，父级路径承担上下文定位', () => {
  const html = render(BulletPage,{panel:{kind:'bullet',id:'2'}});
  const branch = html.slice(html.indexOf('data-bullet-id="3"'), html.indexOf('data-bullet-id="4"'));
  assert.match(branch,/class="knowledge-link branch-title"/);
  assert.doesNotMatch(branch,/class="branch-open"/);
  const prose = html.slice(html.indexOf('data-bullet-id="4"'), html.indexOf('data-bullet-id="5"'));
  assert.equal((prose.match(/class="branch-open"/g)||[]).length,1);
  assert.doesNotMatch(html,/parent-context|在上下文中看|reading-section-controls/);
  const memory = render(MemoryPage,{id:'10'});
  assert.equal((memory.match(/class="knowledge-link association-open"/g)||[]).length,1);
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
