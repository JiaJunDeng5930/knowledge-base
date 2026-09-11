import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';

// 用可控帧时钟检查真实滚动实现的取消与定位契约；不把这组测试称为浏览器动画验收。
const source = new URL('../components/reader-presentation/reading-motion/scroll.ts', import.meta.url);
const output = buildSync({entryPoints:[source.pathname],bundle:true,platform:'node',format:'esm',write:false}).outputFiles[0].text;
const {scrollReadingTo, cancelReadingScroll, isReadingScrollActive, scrollReadingTarget} = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
const css = readFileSync(new URL('../components/reader-presentation/reader.css', import.meta.url),'utf8');
const tokens = new Map([...css.matchAll(/(--reader-motion-[\w-]+):\s*([^;]+);/g)].map(match=>[match[1],match[2]]));

function environment(t, reduced = false) {
  let clock = 0, nextFrame = 0;
  const frames = new Map();
  const media = new EventTarget();
  media.matches = reduced;
  const elements = [];
  const globals = {
    window: {matchMedia:()=>media},
    getComputedStyle: ()=>({getPropertyValue:name=>tokens.get(name)||'', scrollPaddingTop:'24px'}),
    requestAnimationFrame: callback=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame: id=>frames.delete(id),
  };
  const originals = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.mock.method(performance,'now',()=>clock);
  t.after(()=>{
    elements.forEach(cancelReadingScroll);
    for (const [key,descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  });
  function element() {
    const node = Object.assign(new EventTarget(), {
      scrollLeft:0, scrollTop:0, scrollWidth:3000, scrollHeight:4000,
      clientWidth:600, clientHeight:800, isConnected:true, style:{scrollSnapType:'x mandatory'},
      getBoundingClientRect:()=>({top:0}), getAnimations:()=>[],
      scrollTo({left,top}) {
        this.scrollLeft=Math.max(0,Math.min(left,this.scrollWidth-this.clientWidth));
        this.scrollTop=Math.max(0,Math.min(top,this.scrollHeight-this.clientHeight));
      },
    });
    elements.push(node);
    return node;
  }
  function tick(milliseconds) {
    clock+=milliseconds;
    const callbacks=[...frames.values()];frames.clear();
    callbacks.forEach(callback=>callback(clock));
  }
  return {element,tick,frames,media};
}

test('翻页经过中间位置并准确停止，窄屏吸附只在动画期间暂停', t=>{
  const env=environment(t), node=env.element();
  scrollReadingTo(node,{left:1200});
  assert.equal(node.scrollLeft,0);
  assert.equal(node.style.scrollSnapType,'none');
  env.tick(40);
  const first=node.scrollLeft;
  assert.ok(first>0&&first<1200);
  env.tick(40);
  assert.ok(node.scrollLeft>first&&node.scrollLeft<1200);
  env.tick(1000);
  assert.equal(node.scrollLeft,1200);
  assert.equal(node.style.scrollSnapType,'x mandatory');
  assert.equal(isReadingScrollActive(node),false);
  assert.equal(env.frames.size,0);
});

test('快速改选从当前位置接续，旧目标不会在随后帧中重新接管', t=>{
  const env=environment(t), node=env.element();
  scrollReadingTo(node,{left:1800});env.tick(80);
  const before=node.scrollLeft;
  scrollReadingTo(node,{left:0});
  assert.equal(node.scrollLeft,before);
  assert.equal(env.frames.size,1);
  env.tick(40);
  assert.ok(node.scrollLeft<before&&node.scrollLeft>0);
  env.tick(1000);
  assert.equal(node.scrollLeft,0);
  assert.equal(env.frames.size,0);
});

test('手动滚轮、触摸、按下指针和键盘均能接管滚动', t=>{
  const env=environment(t);
  for (const name of ['wheel','touchstart','pointerdown','keydown']) {
    const node=env.element();
    scrollReadingTo(node,{left:1200});env.tick(40);
    node.dispatchEvent(new Event(name));
    const stopped=node.scrollLeft;
    env.tick(1000);
    assert.equal(node.scrollLeft,stopped);
    assert.equal(isReadingScrollActive(node),false);
    assert.equal(node.style.scrollSnapType,'x mandatory');
  }
  assert.equal(env.frames.size,0);
});

test('减少动态效果、初次恢复和越界定位直接使用合法终点', t=>{
  const env=environment(t,true), node=env.element();
  scrollReadingTo(node,{left:99999,top:-10});
  assert.equal(node.scrollLeft,2400);assert.equal(node.scrollTop,0);
  assert.equal(env.frames.size,0);
  env.media.matches=false;
  scrollReadingTo(node,{left:600},true);
  assert.equal(node.scrollLeft,600);assert.equal(env.frames.size,0);
  scrollReadingTo(node,{left:1800});env.tick(40);
  env.media.matches=true;env.media.dispatchEvent(new Event('change'));
  assert.equal(node.scrollLeft,1800);assert.equal(env.frames.size,0);
});

test('已移除的书页停止动画，多个阅读容器互不取消', t=>{
  const env=environment(t), horizontal=env.element(), vertical=env.element();
  scrollReadingTo(horizontal,{left:1200});scrollReadingTo(vertical,{top:1600});
  horizontal.isConnected=false;env.tick(40);
  assert.equal(isReadingScrollActive(horizontal),false);
  assert.equal(isReadingScrollActive(vertical),true);
  env.tick(1000);
  assert.equal(vertical.scrollTop,1600);assert.equal(env.frames.size,0);
});

test('先完成祖先展开再定位原文，等待期间的手动操作会取消定位', async t=>{
  const env=environment(t), node=env.element();
  let finish, targetTop=100;
  const finished=new Promise(resolve=>{finish=resolve;});
  node.getAnimations=()=>[{animationName:'reading-expand',finished}];
  const target={isConnected:true,getBoundingClientRect:()=>({top:targetTop-node.scrollTop})};
  scrollReadingTarget(node,target);
  assert.equal(env.frames.size,0);
  targetTop=1800;finish();await new Promise(resolve=>setImmediate(resolve));env.tick(1000);
  assert.equal(node.scrollTop,1776);

  const waiting=new Promise(resolve=>{finish=resolve;});
  node.getAnimations=()=>[{animationName:'reading-expand',finished:waiting}];
  scrollReadingTarget(node,target);node.dispatchEvent(new Event('wheel'));
  targetTop=2600;finish();await new Promise(resolve=>setImmediate(resolve));env.tick(1000);
  assert.equal(node.scrollTop,1776);
  assert.equal(isReadingScrollActive(node),false);
});
