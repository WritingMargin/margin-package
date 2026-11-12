import {defineAction,definePlugin,type SchemaValue} from './index.mjs';
const echo=defineAction({name:'text.echo',title:'Echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},outputSchema:{type:'object',properties:{words:{type:'integer'}},required:['words']},http:{method:'POST',path:'/echo',reader:false}});
const input:SchemaValue<typeof echo.inputSchema>={text:'hello'};
// @ts-expect-error Request text is a string.
const wrong:SchemaValue<typeof echo.inputSchema>={text:42};
void input;void wrong;
definePlugin({id:'typed',name:'Typed',version:'1',description:'',capabilities:[],actions:[echo]});
defineAction({name:'bad',title:'Bad',inputSchema:{type:'object'},outputSchema:{type:'object'},http:{method:'POST',path:'/bad',reader:false},
 // @ts-expect-error Plugins do not define server handlers.
 handler:()=>({}),
});
import type {BlockAPI} from './browser.mjs';
function blockTypes(client:BlockAPI){
 const actions:readonly string[]=client.context.actions;void actions;
 client.change('{}');client.resize(320);client.setCleanup('session.close',{sessionId:'example'});client.setCleanup(null);
 client.download('notebook.ipynb','application/x-ipynb+json','{}');
 const imported:Promise<{name:string;text:string}|null>=client.importTextFile({accept:'.ipynb',maxBytes:1500000});void imported;
 const result:Promise<{words:number}>=client.action('text.echo',{text:'hello'});void result;
 // @ts-expect-error Source must be text.
 client.change({text:'hello'});
}
void blockTypes;
