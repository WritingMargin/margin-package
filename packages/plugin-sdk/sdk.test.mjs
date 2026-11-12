import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from './index.mjs';
const schema={type:'object',properties:{text:{type:'string',maxLength:100}},required:['text'],additionalProperties:false};
const action=()=>({name:'text.echo',title:'Echo',inputSchema:structuredClone(schema),outputSchema:structuredClone(schema),http:{method:'POST',path:'/echo',reader:false}});
const plugin=actions=>sdk.definePlugin({id:'sdk-test',name:'SDK test',version:'1',description:'',capabilities:[],actions});
test('declarative actions validate schemas and preserve optional description',()=>{
 assert.doesNotThrow(()=>plugin([sdk.defineAction(action())]));
 const unsupported=action();unsupported.inputSchema.pattern='ignored';assert.throws(()=>sdk.defineAction(unsupported),/unsupported/);
 assert.throws(()=>plugin([action(),action()]),/Duplicate/);
 assert.throws(()=>sdk.validateSchema({type:'object',required:['missing']}),/required/);
});
test('declarations snapshot and freeze nested schema metadata',()=>{
 const input=action(),declared=sdk.defineAction(input),defined=plugin([declared]);
 input.inputSchema.properties.text.type='number';
 assert.equal(defined.manifest.actions[0].inputSchema.properties.text.type,'string');
 assert.throws(()=>{declared.http.path='/changed';},TypeError);
});
test('server exports, handler definitions and actions without HTTP mappings are absent',()=>{
 for(const name of ['startPlugin','createPluginServer','pluginHandler'])assert.equal(name in sdk,false);
 assert.throws(()=>sdk.defineAction({...action(),handler(){}}),/unsupported/);
 assert.throws(()=>plugin([{...action(),handler(){}}]),/unsupported/);
 const missing=action();delete missing.http;assert.throws(()=>sdk.defineAction(missing));
});
test('current schema validation bounds data without running code',()=>{
 assert.deepEqual(sdk.validateValue(schema,{text:'hello'}),{text:'hello'});
 for(const input of [{},{text:4},{text:'x'.repeat(101)},{text:'ok',extra:true}])assert.throws(()=>sdk.validateValue(schema,input));
});
