import {test,expect} from '@playwright/test';
import {neon} from '@neondatabase/serverless';

// Operates ONLY on an explicitly isolated Neon fixture and a staging site.
// Required vars documented in docs/PHASE3_TREASURY.md.
test('pending cheque bounces, becomes overdue and writes an append-only event',async({page})=>{
 const env=process.env;
 test.skip(env.E2E_ALLOW_MUTATION!=='isolated-neon-staging'||
  !env.E2E_BASE_URL||!env.E2E_COMPANY_USERNAME||!env.E2E_COMPANY_PASSWORD||
  !env.E2E_COMPANY_ID||!env.E2E_CONTRACT_ID||!env.E2E_INSTALLMENT_ID||
  !env.E2E_READONLY_DATABASE_URL,'Staging-only credentials and fixture are required.');
 const company=env.E2E_COMPANY_ID!;
 await page.goto('/company/login');
 await page.getByLabel('اسم الدخول').fill(env.E2E_COMPANY_USERNAME!);
 await page.getByLabel('كلمة المرور').fill(env.E2E_COMPANY_PASSWORD!);
 await page.getByRole('button',{name:/دخول|Sign in/}).click();
 await expect(page).not.toHaveURL(/company\/login/,{timeout:20000});
 const reference='E2E-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
 const issued=await page.request.post('/api/treasury/cheques',{
  data:{operation:'issue',company_id:company,contract_id:env.E2E_CONTRACT_ID,
   installment_id:env.E2E_INSTALLMENT_ID,amount:'1.00',reference}
 });
 expect(issued.status()).toBe(201);
 const data=await issued.json();
 const id=data.receipt.id as string;
 await page.goto('/treasury?company='+company+'&type=CHEQUE&status=PENDING');
 const row=page.getByRole('row').filter({hasText:reference});
 await expect(row).toBeVisible();
 await row.getByRole('button',{name:'ارتداد'}).click();
 const dialog=page.getByRole('dialog',{name:'إدارة الشيك'});
 await dialog.getByRole('textbox',{name:'سبب الارتداد'}).fill('E2E bounced cheque, no funds collected');
 await dialog.getByRole('button',{name:'تأكيد'}).click();
 await expect(page.getByRole('row').filter({hasText:reference})).toHaveCount(0);
 const status=await page.request.get('/api/treasury/cheques?company='+company);
 expect(status.ok()).toBeTruthy();
 const result=await status.json();
 expect(result.cheques.some((c:{id:string;cheque_state:string})=>c.id===id&&c.cheque_state==='BOUNCED')).toBeTruthy();
 const sql=neon(env.E2E_READONLY_DATABASE_URL!);
 const rows=await sql`SELECT e.id,e.new_state,i.status,i.paid_minor::text
   FROM receipt_cheque_events e
   JOIN receipts r ON r.company_id=e.company_id AND r.id=e.receipt_id
   JOIN contract_installments i ON i.company_id=r.company_id AND i.id=r.installment_id
   WHERE e.company_id=${company}::uuid AND e.receipt_id=${id}::uuid`;
 expect(rows).toHaveLength(1);
 expect(rows[0].new_state).toBe('BOUNCED');
 expect(rows[0].status).toBe('overdue');
 expect(rows[0].paid_minor).toBe('0');
});
