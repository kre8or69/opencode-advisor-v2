import type { Plugin } from '@opencode/plugin';
// Compile the production definition against the real native promise contract.
import plugin from '../../dist/plugin.js';
const definition: Plugin.Plugin = plugin;
export type NativeContext = Plugin.Context;
export type NativeTool = Parameters<Parameters<Plugin.Context['tool']['transform']>[0]>[0];
export { definition };

type Messages = Awaited<ReturnType<NativeContext['session']['context']>>;
type User = Extract<Messages[number], {type:'user'}>;
type Assistant = Extract<Messages[number], {type:'assistant'}>;
type Idle = Extract<Messages[number], {type:'idle'}>;
type Compaction = Extract<Messages[number], {type:'compaction',status:'completed'}>;
export function user(id: string, text: string): User {
	return {id,type:'user',text,time:{created:1}};
}
export function assistant(id: string, text: string, extra: Partial<Assistant> = {}): Assistant {
	return {id,type:'assistant',agent:'opencode-advisor:advisor',model:{providerID:'openai',id:'gpt-6.1-sol'},
		content:[{type:'text',text}],time:{created:1,completed:2},...extra};
}
export function idle(outcome: Idle['outcome']): Idle {return {id:'msg_idle',type:'idle',outcome,time:{created:3}};}
export function compaction(summary:string,recent:string): Compaction {
	return {id:'msg_compaction',type:'compaction',status:'completed',reason:'manual',summary,metadata:{recent},time:{created:0}};
}
export function session(id:string): Awaited<ReturnType<NativeContext['session']['get']>> {
	return {id,projectID:'project',agent:'build',location:{directory:'/workspace'},cost:0,
		tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},time:{created:1,updated:1}};
}
export function admission(sessionID:string,id:string): Awaited<ReturnType<NativeContext['session']['prompt']>> {
	return {id,sessionID,type:'user',payload:{text:'Transcript'},delivery:'steer',time:{created:1}};
}
