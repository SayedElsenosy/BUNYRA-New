type Offer = {
  company: { name: string; name_en?: string; phone?: string; email?: string; address?: string };
  project: { name: string };
  unit: { code: string; building: string; floor: string; category: string; area: string };
  customer?: { full_name: string; phone: string; email?: string; address?: string } | null;
  quote: { plan: { name: string; code: string; down_payment_bps: number; installments: number; interval_months: number }; calculation: { total_minor: string; down_payment_minor: string; installments: Array<{ number: number; due_date: string; amount_minor: string }> } };
  salesperson: { name: string; email: string };
};
function esc(value: unknown) { return String(value ?? '').replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)').replaceAll(/[^\x20-\x7E]/g,'?'); }
function money(minor: string) { const n=BigInt(minor),zero=BigInt(0),hundred=BigInt(100),abs=n<zero?-n:n; return `${n<zero?'-':''}${abs/hundred}.${String(abs%hundred).padStart(2,'0')}`; }
export function renderOfferPdf(data: Offer) {
  const lines = [
    'BUNYRA ERP & CRM', 'PROPERTY OFFER / عرض سعر', '',
    `Company: ${data.company.name_en || data.company.name}`, `Project: ${data.project.name}`,
    `Customer: ${data.customer?.full_name || '—'}`, `Customer phone: ${data.customer?.phone || '—'}`,
    '', 'UNIT DETAILS', `Unit code: ${data.unit.code}`, `Category: ${data.unit.category}`, `Building / Floor: ${data.unit.building} / ${data.unit.floor}`, `Area: ${data.unit.area} sqm`,
    '', 'APPROVED PRICE & PAYMENT PLAN', `Payment plan: ${data.quote.plan.name} (${data.quote.plan.code})`, `Total price: ${money(data.quote.calculation.total_minor)} EGP`, `Down payment: ${money(data.quote.calculation.down_payment_minor)} EGP`,
    ...data.quote.calculation.installments.map(i => `Installment ${i.number}: ${i.due_date} — ${money(i.amount_minor)} EGP`),
    '', `Sales representative: ${data.salesperson.name}`, `Contact: ${data.salesperson.email}`, '', 'This offer is informational and is not a booking, sale, or contract.',
  ];
  const stream = `BT\n/F1 11 Tf\n50 760 Td\n${lines.map((line,i)=>`(${esc(line)}) Tj${i<lines.length-1?' 0 -18 Td':''}`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf='%PDF-1.4\n', offsets=[0]; objects.forEach((object,i)=>{ offsets.push(pdf.length); pdf+=`${i+1} 0 obj\n${object}\nendobj\n`; }); const xref=pdf.length; pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`; for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`; pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return new TextEncoder().encode(pdf);
}
