import test from 'ava';
import plugin from '../dist/plugin.js';
import {user,assistant,idle,compaction,session,admission} from './dist/plugin.test.js';

test('native promise definition has stable id and setup', t => {
	t.is(plugin.id, 'opencode-advisor');
	t.is(typeof plugin.setup, 'function');
});

const agentID = 'opencode-advisor:advisor';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function host(options = {}) {
	const calls = [], agents = {}, hooks = {}, tools = {};
	let serial = 0, disposed = 0, subscriptions = 0;
	const transcripts = new Map();
	const queues = new Set();
	const register = async callback => {callback(); return {dispose:async()=>{disposed++;}};};
	const h = {calls, agents, hooks, tools, transcripts, progress:[], progressSawConsult:[],
		get disposed(){return disposed;}, get subscriptions(){return subscriptions;},
		source:[user('msg_u','Objective'), assistant('msg_previous','Prior advice'), assistant('msg_current','Excluded')],
		ctx:{ options,
			agent:{transform:fn=>register(()=>fn({update:(id, update)=>{agents[id] ??= {}; update(agents[id]);}}))},
			tool:{transform:fn=>register(()=>fn({add:tool=>{tools[tool.name]=tool;}}))},
			event:{subscribe:({signal})=>({async *[Symbol.asyncIterator](){
				subscriptions++; const q=[]; let wake;
				const push=e=>{q.push(e); wake?.();}; queues.add(push);
				const stop=()=>wake?.(); signal.addEventListener('abort',stop);
				try {while(!signal.aborted){if(!q.length) await new Promise(r=>{wake=r;});
					while(q.length) yield q.shift();}}
				finally{queues.delete(push); subscriptions--; signal.removeEventListener('abort',stop);}
			}})},
			session:{
				hook:async(name,fn)=>{hooks[name]=fn; return {dispose:async()=>{disposed++;}};},
				context:async({sessionID})=>transcripts.get(sessionID) ?? h.source,
				get:async()=>session('ses_source'),
				create:async input=>{calls.push(['create',input]); const id=`ses_temp${++serial}`; transcripts.set(id,[]); return session(id);},
				prompt:async input=>{calls.push(['prompt',input]); const id=`msg_input${serial}`;
					transcripts.set(input.sessionID,[user(id,input.text)]);
					if(h.auto) setTimeout(()=>h.complete(input.sessionID,id),10);
					return admission(input.sessionID,id);},
				interrupt:async input=>{calls.push(['interrupt',input]);return {interrupted:true};},
				wait:async input=>{calls.push(['wait',input]);},
				remove:async input=>{calls.push(['remove',input]);transcripts.delete(input.sessionID);},
			},
		}, auto:true,
		emit(type,sessionID, data={}){for(const q of queues)q({type,data:{sessionID,...data}});},
		complete(sessionID,id, text='Advice', outcome='succeeded'){
			transcripts.set(sessionID,[user(id,'Transcript'),assistant('msg_answer',text),idle(outcome)]);
			h.emit(`session.execution.${outcome}`,sessionID);
		},
		async setup(){h.cleanup=await plugin.setup(h.ctx);},
		run(sessionID='ses_source', extra={}, input={}){
			return tools.advisor.execute(input, {sessionID,messageID:'msg_current',agent:'build',
				signal:new AbortController().signal,
				progress:async update=>{h.progress.push(update);h.progressSawConsult.push(h.calls.some(c=>c[0]==='create'||c[0]==='prompt'));},...extra});
		},
	}; return h;
}

for(const [model,variant] of [['ollama-cloud/kimi-k3','max'],['openai/gpt-6.1-sol','xhigh']]){
	test(`registers native agent and tool for ${model} ${variant}`,async t=>{
		const h=host({model,variant,temperature:0.4,top_p:0.8}); await h.setup();
		t.deepEqual(h.agents[agentID].model,{providerID:model.split('/')[0],id:model.split('/')[1],variant});
		t.true(h.agents[agentID].hidden); t.is(h.agents[agentID].mode,'subagent');
		t.false(h.tools.advisor.options.codemode); t.deepEqual(h.tools.advisor.input,{type:'object',properties:{topic:{type:'string',description:'One-line summary of the question or decision, for display only.'}},additionalProperties:false});
		t.regex(h.tools.advisor.description,/active.*context/i);
		const e={agent:agentID,options:{},tools:Object.fromEntries(['read','glob','grep','webfetch','websearch','skill','shell','advisor','edit','mcp_read','subagent'].map(k=>[k,{}]))};
		await h.hooks.context(e); t.deepEqual(Object.keys(e.tools),['read','glob','grep','webfetch','websearch','skill']);
		t.deepEqual(e.options,{temperature:0.4,topP:0.8});
		const source={agent:'build',options:{},tools:{shell:{}}}; await h.hooks.context(source); t.deepEqual(source.options,{}); t.truthy(source.tools.shell);
		await h.cleanup(); t.is(h.disposed,3);
	});
}

test('topic labels the consultation card and child session',async t=>{
	const h=host();await h.setup();
	const r=await h.run('ses_source',{}, {topic:'  choosing between A\nand B  '});
	t.is(r.content,'Advice');
	t.is(r.metadata.title,'Advisor — choosing between A and B');
	t.deepEqual(h.progress[0],{title:'Advisor — choosing between A and B'});
	t.deepEqual(h.progressSawConsult,[false]);
	t.is(h.calls.find(c=>c[0]==='create')[1].title,'advisor — choosing between A and B');
	await h.cleanup();
});
test('no topic uses the consulting fallback',async t=>{
	const h=host();await h.setup();
	const r=await h.run();
	t.is(r.metadata.title,'Advisor — consulting…');
	t.deepEqual(h.progress[0],{title:'Advisor — consulting…'});
	t.is(h.calls.find(c=>c[0]==='create')[1].title,'advisor — consulting');
	await h.cleanup();
});
test('topic is truncated to one line of 120 characters',async t=>{
	const h=host();await h.setup();
	const r=await h.run('ses_source',{}, {topic:'x'.repeat(200)});
	t.is(r.metadata.title,`Advisor — ${'x'.repeat(119)}…`);
	t.is(Array.from(r.metadata.title).length,Array.from('Advisor — ').length+120);
	t.false(r.metadata.title.includes('\n'));
	await h.cleanup();
});
test('topic with a newline and controls collapses to one line',async t=>{
	const h=host();await h.setup();
	const r=await h.run('ses_source',{}, {topic:'line one\nline two\u0000line three'});
	t.is(r.metadata.title,'Advisor — line one line two line three');
	t.false(r.metadata.title.includes('\n'));
	t.is(h.calls.find(c=>c[0]==='create')[1].title,'advisor — line one line two line three');
	await h.cleanup();
});
test('truncation does not split a surrogate pair',async t=>{
	const h=host();await h.setup();
	const r=await h.run('ses_source',{}, {topic:'😀'.repeat(200)});
	t.is(r.metadata.title,`Advisor — ${'😀'.repeat(119)}…`);
	await h.cleanup();
});
test('empty, whitespace-only, and non-string topics use the fallback',async t=>{
	for(const topic of ['','   ','\n\t',42,null,{},[]]){
		const h=host();await h.setup();
		const r=await h.run('ses_source',{}, {topic});
		t.is(r.metadata.title,'Advisor — consulting…');
		t.is(h.calls.find(c=>c[0]==='create')[1].title,'advisor — consulting');
		await h.cleanup();
	}
});
test('progress rejection still returns advice with a title',async t=>{
	const h=host();await h.setup();
	const r=await h.run('ses_source',{progress:async()=>{throw Error('progress failed');}},{topic:'rejecting progress'});
	t.is(r.content,'Advice');
	t.is(r.metadata.title,'Advisor — rejecting progress');
	t.is(h.calls.find(c=>c[0]==='create')[1].title,'advisor — rejecting progress');
	await h.cleanup();
});
test('stalled progress times out with a title and releases the guard',async t=>{
	const h=host({timeoutMs:100});await h.setup();
	const r=await h.run('ses_source',{progress:()=>new Promise(()=>{})},{topic:'stalled progress'});
	t.regex(r.content,/timed out/);
	t.is(r.metadata.title,'Advisor — stalled progress');
	t.is((await h.run()).content,'Advice');
	await h.cleanup();
});

for(const options of [null,[],{foo:1},{options:{}},{failureThreshold:3},{model:'bad'},{variant:3},{prompt:3},{temperature:NaN},{top_p:Infinity},{timeoutMs:0},{timeoutMs:1.5},{timeoutMs:'1'}]){
	test(`rejects invalid options ${JSON.stringify(options)}`,async t=>{const h=host(options);await t.throwsAsync(()=>h.setup(),{message:/advisor.*(option|model|variant|prompt|temperature|top_p|timeoutMs)/i}); t.is(h.calls.length,0);});
}
test('embedded variant and explicit override; defaults and empty prompt',async t=>{
	const h=host({model:'openai/gpt-6.1-sol#high',variant:'xhigh',prompt:''});await h.setup();
	t.is(h.agents[agentID].model.variant,'xhigh');t.is(h.agents[agentID].system,'');await h.cleanup();
	const d=host();await d.setup(); t.deepEqual(d.agents[agentID].model,{providerID:'deepseek',id:'deepseek-v4-pro'});await d.cleanup();
});
test('active text transcript includes compaction and prior assistant but excludes caller',async t=>{
	const h=host();h.source.unshift(compaction('Earlier objective','Recent state'));
	await h.setup();const result=await h.run(); t.is(result.content,'Advice');
	const create=h.calls.find(c=>c[0]==='create')[1];t.deepEqual(create.permissions,h.agents[agentID].permissions);
	t.deepEqual(create.location,{directory:'/workspace'});t.is(create.agent,agentID);t.falsy(create.parentID);
	t.deepEqual(create.permissions.find(p=>p.action==='shell'),{action:'shell',resource:'*',effect:'deny'});
	const text=h.calls.find(c=>c[0]==='prompt')[1].text;t.regex(text,/Earlier objective/);t.regex(text,/Recent state/);t.regex(text,/Prior advice/);t.notRegex(text,/Excluded/);
	t.is(h.calls.at(-1)[0],'remove');await h.cleanup();t.is(h.subscriptions,0);
});
test('empty transcript declines without create or prompt',async t=>{const h=host();h.source=[];await h.setup();t.regex((await h.run()).content,/declined/);t.is(h.calls.length,0);await h.cleanup();});
test('admission and unrelated completion do not finish; terminal success requires correlated input',async t=>{
	const h=host();h.auto=false;await h.setup();let settled=false;const pending=h.run().then(r=>{settled=true;return r;});await tick();
	h.emit('session.execution.succeeded','ses_other');await tick();t.false(settled);
	h.transcripts.set('ses_temp1',[user('msg_wrong','wrong'),assistant('msg_answer','Wrong')]);h.emit('session.execution.succeeded','ses_temp1');await tick();t.false(settled);
	h.complete('ses_temp1','msg_input1');t.is((await pending).content,'Advice');await h.cleanup();
});
test('success event before prompt admission resolves is retained',async t=>{
	const h=host();h.ctx.session.prompt=async({sessionID})=>{h.complete(sessionID,'msg_early');await tick();return {id:'msg_early',sessionID};};await h.setup();t.is((await h.run()).content,'Advice');await h.cleanup();
});
for(const outcome of ['failed','interrupted']) test(`terminal ${outcome} returns diagnostic and cleans up`,async t=>{
	const h=host();h.ctx.session.prompt=async({sessionID})=>{h.complete(sessionID,'msg_input','Do not return',outcome);return{id:'msg_input',sessionID};};await h.setup();t.regex((await h.run()).content,new RegExp(outcome));t.is(h.calls.at(-1)[0],'remove');await h.cleanup();
});
test('completed output with no text returns no advice',async t=>{const h=host();h.ctx.session.prompt=async({sessionID})=>{h.complete(sessionID,'msg_input','');return{id:'msg_input',sessionID};};await h.setup();t.regex((await h.run()).content,/no advice/);await h.cleanup();});
for(const method of ['create','prompt'])test(`${method} failure releases guard`,async t=>{
	const h=host();const old=h.ctx.session[method];h.ctx.session[method]=async()=>{throw Error('boom');};await h.setup();
	const failed=await h.run('ses_source',{}, {topic:'failure path'});t.regex(failed.content,/boom/);t.is(failed.metadata.title,'Advisor — failure path');
	h.ctx.session[method]=old;t.is((await h.run('ses_source',{}, {topic:'retry'})).content,'Advice');await h.cleanup();
});
test('same-source overlap rejected while independent sources run',async t=>{
	const h=host();await h.setup();const a=h.run();t.regex((await h.run()).content,/already.*progress/);const b=h.run('ses_other');t.is((await a).content,'Advice');t.is((await b).content,'Advice');await h.cleanup();
});
test('agent and temporary-session recursion rejected',async t=>{
	const h=host();await h.setup();t.regex((await h.run('ses_source',{agent:agentID})).content,/recurs/);const p=h.run();await tick();t.regex((await h.run('ses_temp1')).content,/recurs/);await p;await h.cleanup();
});
for(const phase of ['before','create','prompt','wait'])test(`cancellation ${phase} interrupts and cleans up`,async t=>{
	const h=host();h.auto=false;const ac=new AbortController();
	if(phase==='before')ac.abort();
	if(phase==='create'||phase==='prompt'){const old=h.ctx.session[phase];h.ctx.session[phase]=async input=>{const result=await old(input);ac.abort();return result;};}
	await h.setup();const p=h.run('ses_source',{signal:ac.signal});if(phase==='wait'){await tick();ac.abort();}
	t.regex((await p).content,/cancel/i);if(phase!=='before')t.is(h.calls.at(-1)[0],'remove');await h.cleanup();t.is(h.subscriptions,0);
});
test('deadline interrupts stalled consultation and releases guard',async t=>{const h=host({timeoutMs:20});h.auto=false;await h.setup();t.regex((await h.run()).content,/timed out/);t.deepEqual(h.calls.slice(-3).map(c=>c[0]),['interrupt','wait','remove']);await h.cleanup();});
test('cleanup error preserves advice with warning',async t=>{const h=host();h.ctx.session.remove=async()=>{throw Error('remove failed');};await h.setup();const r=await h.run();t.regex(r.content,/Advice/);t.regex(r.content,/cleanup.*remove failed/i);await h.cleanup();});
test('unload cancels calls, disposes registrations and denies future calls',async t=>{const h=host();h.auto=false;await h.setup();const p=h.run();await tick();await h.cleanup();t.regex((await p).content,/cancel|unload/i);t.is(h.disposed,3);t.is(h.subscriptions,0);t.regex((await h.run()).content,/unload/i);});

test('persisted correlated terminal succeeds even when subscription misses notification',async t=>{
	const h=host({timeoutMs:100});h.emit=()=>{};await h.setup();t.is((await h.run()).content,'Advice');await h.cleanup();
});
test('unexpected event stream closure still checks persisted terminal',async t=>{
	const h=host({timeoutMs:100});h.ctx.event.subscribe=()=>({async *[Symbol.asyncIterator](){}});await h.setup();t.is((await h.run()).content,'Advice');await h.cleanup();
});
test('empty compaction text declines',async t=>{
	const h=host();h.source=[compaction('','')];await h.setup();t.regex((await h.run()).content,/declined/);t.is(h.calls.length,0);await h.cleanup();
});
test('another input cannot donate output to the admitted turn',async t=>{
	const h=host({timeoutMs:100});h.ctx.session.prompt=async({sessionID})=>{
		h.transcripts.set(sessionID,[user('msg_own','own'),user('msg_foreign','foreign'),assistant('msg_answer','Wrong'),{type:'idle',outcome:'succeeded'}]);
		h.emit('session.execution.succeeded',sessionID);return{id:'msg_own',sessionID};};
	await h.setup();t.not((await h.run()).content,'Wrong');await h.cleanup();
});
test('assistant error and unfinished output are not successful advice',async t=>{
	const h=host({timeoutMs:50});h.ctx.session.prompt=async({sessionID})=>{h.complete(sessionID,'msg_own');h.transcripts.get(sessionID)[1].error={message:'provider failed'};return{id:'msg_own',sessionID};};
	await h.setup();t.regex((await h.run()).content,/failed/);await h.cleanup();
	const u=host({timeoutMs:50});u.ctx.session.prompt=async({sessionID})=>{u.complete(sessionID,'msg_own');u.transcripts.get(sessionID)[1].time={};return{id:'msg_own',sessionID};};await u.setup();t.regex((await u.run()).content,/timed out/);await u.cleanup();
});
test('late prompt settlement after bounded cleanup is interrupted and removed again',async t=>{
	const h=host({timeoutMs:20});let resolve;
	h.ctx.session.prompt=()=>new Promise(r=>{resolve=r;});await h.setup();const p=h.run();
	const result=await p;t.regex(result.content,/prompt settlement.*timed out/);
	const before=h.calls.filter(c=>c[0]==='remove').length;
	resolve({id:'msg_late',sessionID:'ses_temp1'});await tick();
	t.true(h.calls.filter(c=>c[0]==='remove').length>before);await h.cleanup();
});
test('late creation after bounded cleanup is eventually removed',async t=>{
	const h=host({timeoutMs:20});let resolve;h.ctx.session.create=()=>new Promise(r=>{resolve=r;});await h.setup();const result=await h.run();t.regex(result.content,/create settlement.*timed out/);
	resolve({id:'ses_late'});await tick();t.true(h.calls.some(c=>c[0]==='remove'&&c[1].sessionID==='ses_late'));await h.cleanup();
});
test('cleanup timeout is bounded and same-source guard is held until attempts finish',async t=>{
	const h=host();h.ctx.session.remove=()=>new Promise(()=>{});await h.setup();const p=h.run();await new Promise(r=>setTimeout(r,50));t.regex((await h.run()).content,/already.*progress/);
	t.regex((await p).content,/Advice.*cleanup warning:[\s\S]*timed out/s);await h.cleanup();
});
test('registration failure rolls back completed registrations',async t=>{
	const h=host();h.ctx.tool.transform=async()=>{throw Error('register failed');};await t.throwsAsync(()=>h.setup(),{message:'register failed'});t.is(h.disposed,2);
});
test('disposal errors are reported after all registrations are attempted',async t=>{
	const h=host();h.ctx.session.hook=async()=>({dispose:async()=>{throw Error('hook failure');}});await h.setup();await t.throwsAsync(()=>h.cleanup(),{message:/disposal failed.*hook failure/});t.is(h.disposed,2);
});
test('interrupt settlement is awaited before removal',async t=>{
	const h=host({timeoutMs:20});h.auto=false;await h.setup();await h.run();
	t.deepEqual(h.calls.slice(-3).map(c=>c[0]),['interrupt','wait','remove']);await h.cleanup();
});
test('source and consultant deletion cancel active consultation',async t=>{
	for(const sessionID of ['ses_source','ses_temp1']){
		const h=host();h.auto=false;await h.setup();const pending=h.run();await tick();h.emit('session.deleted',sessionID);
		t.regex((await pending).content,/session deleted/);t.is(h.calls.at(-1)[0],'remove');await h.cleanup();
	}
});
test('context and caller-location errors release guard',async t=>{
	for(const method of ['context','get']){const h=host();const old=h.ctx.session[method];h.ctx.session[method]=async()=>{throw Error('lookup failed');};await h.setup();t.regex((await h.run()).content,/lookup failed/);h.ctx.session[method]=old;t.is((await h.run()).content,'Advice');await h.cleanup();}
});
test('source agent lookup prevents recursion even if tool context is stale',async t=>{
	const h=host();h.ctx.session.get=async()=>({agent:agentID,location:{directory:'/workspace'}});await h.setup();t.regex((await h.run()).content,/recurs/);t.false(h.calls.some(c=>c[0]==='create'));await h.cleanup();
});
test('no advice until admitted output has completed and terminal boundary exists',async t=>{
	const h=host();h.auto=false;await h.setup();let settled=false;const p=h.run().then(r=>{settled=true;return r;});await tick();
	h.transcripts.set('ses_temp1',[user('msg_input1','own'),assistant('msg_partial','Partial',{time:{}})]);h.emit('session.execution.succeeded','ses_temp1');await tick();t.false(settled);
	h.complete('ses_temp1','msg_input1','Final');t.is((await p).content,'Final');await h.cleanup();
});
test('safe-tool discovery and fixed permissions do not widen on replay',async t=>{
	const h=host();h.ctx.agent.transform=async fn=>{const editor={update:(id,update)=>{h.agents[id]??={permissions:[{action:'*',resource:'*',effect:'allow'}]};update(h.agents[id]);}};fn(editor);fn(editor);return{dispose:async()=>{}};};await h.setup();
	t.is(h.agents[agentID].permissions[0].effect,'deny');t.is(h.agents[agentID].permissions.at(-1).action,'shell');await h.cleanup();
});
