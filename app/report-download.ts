/** Download a scoped report after verifying a successful CSV response.
 * Keeps API authorization errors from being saved as empty CSVs. */
export async function downloadReportCsv(params:URLSearchParams,filename:string){
 const response=await fetch('/api/reports-export?'+params.toString(),{cache:'no-store',credentials:'same-origin'});
 if(!response.ok){
  let code='EXPORT_FAILED';
  try{code=(await response.json()).error||code;}catch{}
  throw new Error(code);
 }
 if(!(response.headers.get('content-type')||'').includes('text/csv'))throw new Error('EXPORT_FAILED');
 const blob=await response.blob();
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');
 anchor.href=url;anchor.download=filename;anchor.style.display='none';
 document.body.appendChild(anchor);
 try{anchor.click();}
 finally{anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
