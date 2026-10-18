'use client';
import { useEffect, useState } from 'react';
import { Check, Inbox, RefreshCw, X } from 'lucide-react';

type Request = { id: string; company_name: string; company_name_en: string; contact_name: string; email: string; phone: string; message: string; status: 'pending' | 'approved' | 'rejected'; review_note: string; version: number; created_at: string };

export default function RequestsPanel({ en, onChanged, onInvite }: { en: boolean; onChanged: () => void; onInvite: (link: string) => void }) {
  const t = (ar: string, eng: string) => (en ? eng : ar);
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/company-requests');
      if (!r.ok) throw new Error();
      setRows((await r.json()).requests);
    } catch {
      setError(t('تعذر تحميل الطلبات', 'Could not load requests'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function review(row: Request, decision: 'approve' | 'reject') {
    const note = decision === 'reject' ? prompt(t('سبب الرفض (اختياري)', 'Reason for rejection (optional)')) : '';
    if (note === null) return;
    if (decision === 'approve' && !confirm(t('سيتم إنشاء الشركة ودعوة مقدم الطلب كمدير لها. متابعة؟', 'This creates the company and invites the requester as its admin. Continue?'))) return;
    setBusy(row.id);
    setError('');
    try {
      const r = await fetch('/api/company-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, version: row.version, decision, note }) });
      if (!r.ok) throw new Error(r.status === 409 ? 'conflict' : 'save');
      const d = await r.json();
      if (d.invite) onInvite(location.origin + '/join#token=' + d.invite.token);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message === 'conflict' ? t('تمت مراجعة الطلب بالفعل. حدّث الصفحة.', 'Already reviewed. Refresh the list.') : t('تعذر حفظ القرار', 'Could not save the decision'));
    } finally {
      setBusy('');
    }
  }

  const status = (s: Request['status']) => (s === 'pending' ? t('قيد المراجعة', 'Pending') : s === 'approved' ? t('مقبول', 'Approved') : t('مرفوض', 'Rejected'));
  const date = (v: string) => new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v));

  return (
    <section className="panel companies-panel">
      <div className="panel-heading">
        <div className="title-line"><h2>{t('طلبات تسجيل الشركات', 'Company registration requests')}</h2><span className="count">{rows.filter(r => r.status === 'pending').length}</span></div>
        <button className="secondary icon-button" aria-label={t('تحديث', 'Refresh')} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {rows.length ? (
        <div className="table-scroll"><table>
          <thead><tr>{[t('الشركة', 'Company'), t('مقدم الطلب', 'Contact'), t('التواصل', 'Contact details'), t('التاريخ', 'Date'), t('الحالة', 'Status'), t('الإجراءات', 'Actions')].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td><strong>{en ? r.company_name_en || r.company_name : r.company_name}</strong>{r.message && <small className="request-message">{r.message}</small>}</td>
              <td>{r.contact_name}</td>
              <td dir="ltr">{r.email}{r.phone && <small className="request-message">{r.phone}</small>}</td>
              <td>{date(r.created_at)}</td>
              <td><span className={'badge ' + (r.status === 'approved' ? 'active' : r.status === 'rejected' ? 'deleted' : 'suspended')}><i />{status(r.status)}</span>{r.review_note && <small className="request-message">{r.review_note}</small>}</td>
              <td>{r.status === 'pending' && <div className="row-actions">
                <button disabled={!!busy} onClick={() => void review(r, 'approve')}><Check size={14} /> {t('قبول', 'Approve')}</button>
                <button disabled={!!busy} onClick={() => void review(r, 'reject')}><X size={14} /> {t('رفض', 'Reject')}</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : !loading && (
        <div className="empty"><Inbox size={32} /><h3>{t('لا توجد طلبات بعد', 'No requests yet')}</h3><p>{t('تصل الطلبات من صفحة التسجيل العامة /register', 'Requests arrive from the public /register page')}</p></div>
      )}
    </section>
  );
}
