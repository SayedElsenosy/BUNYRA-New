import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/tests',{recursive:true});
for(const name of ['permissions','service']){
 const source=fs.readFileSync(`lib/bunyra/${name}.ts`,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replace("from './permissions'","from './permissions.mjs'");
 fs.writeFileSync(`.sites-runtime/tests/${name}.mjs`,js);
}
console.log('Compiled exact service sources for database integration tests.');
