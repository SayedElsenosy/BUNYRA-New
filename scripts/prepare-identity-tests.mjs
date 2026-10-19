import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/tests',{recursive:true});
for(const name of ['tenant','platform','companies','permissions','service','organization','projects','inventory','unit-fields','xlsx-visibility','imports','inventory-sync','import-format','plan-limits','plan-files','plan-transfer','plan-layout','storage']){
 const source=fs.readFileSync(`lib/bunyra/${name}.ts`,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll("from './imports'","from './imports.mjs'").replaceAll("from './unit-fields'","from './unit-fields.mjs'").replaceAll("from './import-format'","from './import-format.mjs'").replaceAll("from './plan-layout'","from './plan-layout.mjs'").replaceAll("from './plan-limits'","from './plan-limits.mjs'").replaceAll("from './plan-files'","from './plan-files.mjs'").replaceAll("from './plan-transfer'","from './plan-transfer.mjs'").replaceAll("from './inventory'","from './inventory.mjs'").replaceAll("from './projects'","from './projects.mjs'").replaceAll("from './permissions'","from './permissions.mjs'").replaceAll("from './service'","from './service.mjs'").replaceAll("from './tenant'","from './tenant.mjs'");
 fs.writeFileSync(`.sites-runtime/tests/${name}.mjs`,js);
}
console.log('Compiled exact service sources for database integration tests.');
