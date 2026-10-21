import {readFileSync} from 'node:fs';
export function setupDOM() {
 const html=readFileSync(new URL('index.html',import.meta.url),'utf8'), nodes=new Map(), events=new Map(), globalEvents=new Map(), intervals=new Map(), storage=new Map();
 class Element {
  constructor(id=''){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.inert=false;this.dataset={};this.attributes=new Map();this.listeners=new Map();this.controls=[];this.children=[];this.files=[];this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,on)=>{const yes=on??!this.classes.has(x);yes?this.classes.add(x):this.classes.delete(x);return yes;}};this.style={properties:new Map(),setProperty(name,value){this.properties.set(name,String(value));},getPropertyValue(name){return this.properties.get(name)||'';},removeProperty(name){this.properties.delete(name);}};}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  async fire(type,event={}){for(const fn of this.listeners.get(type)||[])await fn(event);}
  querySelectorAll(){return this.controls;} querySelector(){return this.controls[0]||null;}
  setAttribute(k,v){this.attributes.set(k,v);} removeAttribute(k){this.attributes.delete(k);} getAttribute(k){return this.attributes.get(k)??null;}
  focus(){document.activeElement=this;} appendChild(child){this.children.push(child);return child;} remove(){} closest(){return this;} reset(){this.value='';} getClientRects(){return this.hidden?[]:[{}];} click(){return this.onclick?.({preventDefault(){},target:this});}
 }
 for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set(match[1],new Element(match[1]));
 const shell=new Element('shell'),root=new Element('html');root.dataset={theme:'dark'};
 const links=[...html.matchAll(/<a[^>]+data-view="([^"]+)"/g)].map(match=>{const el=new Element();el.dataset.view=match[1];return el;});
 const views=[...nodes.values()].filter(el=>el.id.startsWith('view-'));
 const tabs=['login','import'].map(tab=>{const el=new Element();el.dataset.tab=tab;return el;});
 const find=id=>{const el=nodes.get(id);if(!el)throw new Error('Missing actual HTML id: '+id);return el;};
 for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){const el=find(match[1]);el.hidden=/\shidden(?:\s|>)/.test(match[0]);const value=match[0].match(/value="([^"]*)"/);if(value)el.value=value[1];}
 const document={hidden:false,documentElement:root,activeElement:root,getElementById:id=>nodes.get(id)||null,createElement:()=>new Element(),querySelector:selector=>selector==='.shell'?shell:selector.includes('addRealm')?{value:'cn'}:null,querySelectorAll:selector=>selector==='.nav a'?links:selector==='.view'?views:selector==='#addTabs .tab'?tabs:[],addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},removeEventListener:(type,fn)=>{events.set(type,(events.get(type)||[]).filter(item=>item!==fn));},dispatchEvent:event=>{for(const fn of events.get(event.type)||[])fn(event);return true;}};
 globalThis.document=document;globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options?.detail;}};
 const observers=[];
 globalThis.MutationObserver=class{constructor(callback){this.callback=callback;this.target=null;this.observing=false;observers.push(this);}observe(target){this.target=target;this.observing=true;}disconnect(){this.observing=false;}takeRecords(){return[];}};
 async function mutation(){for(const observer of observers)if(observer.observing)await observer.callback([],observer);}

 globalThis.addEventListener=(type,fn)=>{if(!globalEvents.has(type))globalEvents.set(type,[]);globalEvents.get(type).push(fn);};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
 globalThis.location={origin:'http://[::1]:9123',hash:'',reload(){}};globalThis.history={replaceState(_a,_b,hash){location.hash=hash;}};
 globalThis.confirm=()=>true;globalThis.open=()=>{};
 let nextTimer=0;globalThis.setInterval=fn=>{const id=++nextTimer;intervals.set(id,fn);return id;};globalThis.clearInterval=id=>intervals.delete(id);
 const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);timer.unref?.();return timer;};
 const target=dataset=>({dataset,disabled:false,closest(){return this;}});
 async function emit(type,detail){for(const fn of events.get(type)||[])await fn({type,detail});}
 async function click(id,dataset){const el=find(id);if(dataset)await el.fire('click',{target:target(dataset),preventDefault(){}});else await el.onclick?.({target:el,preventDefault(){}});}
 return {$:find,nodes,events,intervals,storage,links,views,shell,root,Element,observers,mutation,emit,click,target};
}
export function mockAPI(handler) {
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{const call={url,opts};calls.push(call);const result=await handler(url,opts,call);const status=result?.status??200;return{status,ok:status>=200&&status<300,json:async()=>result?.body??result??{}};};
 return calls;
}
export const flush=()=>new Promise(resolve=>setImmediate(resolve));
