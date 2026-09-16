// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepSeekClient } from './deepseek-client';

let directory: string;
afterEach(async () => {vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (directory) await rm(directory,{recursive:true,force:true});});

it('reports final stream usage once and records consumer cancellation as interrupted', async () => {
 directory=await mkdtemp(join(tmpdir(),'sabc-usage-'));
 vi.stubEnv('USAGE_MONITOR_INTERNAL_SECRET','test');vi.stubEnv('USAGE_MONITOR_OUTBOX_DIR',directory);vi.stubEnv('MAIN_APP_URL','https://main.test');vi.stubEnv('MAIN_APP_SSO_CLIENT_SECRET','test');vi.stubEnv('VITEST','');
 const reports: Array<Record<string, unknown>>=[],bills: Array<Record<string, unknown>>=[];
 vi.stubGlobal('fetch',async (url: string,init: RequestInit)=>{(url.endsWith('/api/sso/usage')?reports:bills).push(JSON.parse(String(init.body)));return Response.json({success:true});});
 const frames=['data: '+JSON.stringify({choices:[{delta:{content:'hello'}}]}),'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:12,completion_tokens:6,prompt_tokens_details:{cached_tokens:4},completion_tokens_details:{reasoning_tokens:2}}}),'data: [DONE]'];
 const client=new DeepSeekClient({endpoint:'https://api.openlux.ai/v1/chat/completions',apiKey:'private',model:'m',billingUserId:'employee',billingEnabled:true,fetchImpl:async(_url,init)=>{
  expect(JSON.parse(String(init?.body)).stream_options).toEqual({include_usage:true});
  return new Response(frames.join('\n')+'\n');
 }});
 for await(const chunk of client.stream({systemPrompt:'private',userPrompt:'private'})) expect(chunk).toBe('hello');
 const terminal=reports.filter(e=>e.status==='completed'); expect(terminal).toHaveLength(1);
 expect(terminal[0]).toMatchObject({userId:'employee',inputTokens:12,outputTokens:6,totalTokens:18,cachedInputTokens:4,reasoningTokens:2});
 expect(bills.every(bill=>bill.usageReportedSeparately===true && bill.providerId==='api.openlux.ai' && bill.userId==='employee')).toBe(true);
 reports.length=0;
 for await(const chunk of client.stream({systemPrompt:'private',userPrompt:'private'})) {expect(chunk).toBe('hello');break;}
 expect(reports.at(-1)?.status).toBe('interrupted');
 expect(reports.at(-1)?.inputTokens).toBeNull();
 frames[0]='data: '+JSON.stringify({choices:[{delta:{content:'hello'}}],usage:{prompt_tokens:9,completion_tokens:1}});
 for await(const chunk of client.stream({systemPrompt:'private',userPrompt:'private'})) {expect(chunk).toBe('hello');break;}
 expect(reports.at(-1)).toMatchObject({status:'interrupted',inputTokens:9,outputTokens:1});
 const completedClient=new DeepSeekClient({endpoint:'https://api.openlux.ai/v1/chat/completions',apiKey:'private',model:'actual-model',billingUserId:'employee',billingEnabled:true,fetchImpl:async()=>Response.json({choices:[{message:{content:'{}'}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}})});
 await completedClient.generate({systemPrompt:'private',userPrompt:'private'});
 expect(reports.at(-1)).toMatchObject({status:'completed',model:'actual-model',totalTokens:0});
 reports.length=0;bills.length=0;
 const other=new DeepSeekClient({endpoint:'https://yunwu.ai/v1/chat/completions',apiKey:'private',model:'openlux-label',billingUserId:'employee',billingEnabled:true,fetchImpl:async()=>Response.json({choices:[{message:{content:'{}'}}]})});
 await other.generate({systemPrompt:'private',userPrompt:'private'});
 expect(reports).toHaveLength(0);expect(bills.every(bill=>!bill.usageReportedSeparately&&bill.providerId==='yunwu.ai')).toBe(true);
});
