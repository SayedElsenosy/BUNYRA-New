'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Building2, Globe, Moon, Sun } from 'lucide-react';

const empty = { company_name: '', company_name_en: '', contact_name: '', email: '', phone: '', message: '', website: '' };

export default function Register() {
  const [en, setEn] = useState(false);
  const [dark, setDark] = useState(false);
  const [form, setForm] = useState(empty);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'pending' | 'error'>('idle');
  const t = (ar: string, eng: string) => (en ? eng : ar);

  useEffect(() => { setEn(localStorage.getItem('bunyra-language') === 'en'); setDark(localStorage.getItem('bunyra-theme') === 'dark'); }, []);
  useEffect(() => {
    document.documentElement.lang = en ? 'en' : 'ar';
    document.documentElement.dir = en ? 'ltr' : 'rtl';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('bunyra-language', en ? 'en' : 'ar');
    localStorage.setItem('bunyra-theme', dark ? 'dark' : 'light');
  }, [en, dark]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('saving');
    try {
      const r = await fetch('/api/company-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setState(r.ok ? 'done' : r.status === 409 ? 'pending' : 'error');
      if (r.ok) setForm(empty);
    } catch { setState('error'); }
  }

  const field = (key: keyof typeof empty, ar: string, eng: string, opts: { required?: boolean; type?: string; max: number; dir?: string }) => (
    <label key={key}>{t(ar, eng)}{opts.required && <span className="required"> *</span>}
      <input required={opts.required} type={opts.type || 'text'} maxLength={opts.max} minLength={opts.required ? 2 : undefined} dir={opts.dir} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <main className="public-page">
      <div className="top-actions public-actions">
        <button className="icon-button" aria-label={t('تغيير اللغة', 'Change language')} onClick={() => setEn(!en)}><Globe size={18} /><span>{en ? 'ع' : 'EN'}</span></button>
        <button className="icon-button" aria-label={t('تغيير المظهر', 'Change theme')} onClick={() => setDark(!dark)}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
      </div>
      <section className="panel public-form modal">
        <div className="title-line"><span className="strip-icon"><Building2 size={22} /></span><div><h1>{t('طلب حساب شركة على BUNYRA', 'Request a BUNYRA company account')}</h1><p className="muted">{t('يراجع فريق المنصة الطلب، وعند الموافقة تصلك دعوة كمدير للشركة.', 'The platform team reviews your request; once approved you receive a company-admin invitation.')}</p></div></div>
        {state === 'done' ? <p className="success-note" role="status">{t('تم استلام طلبك. سنتواصل معك بعد المراجعة.', 'Request received. We will contact you after review.')}</p> : (
          <form onSubmit={submit}>
            <div className="form-grid">
              {field('company_name', 'اسم الشركة', 'Company name', { required: true, max: 160 })}
              {field('company_name_en', 'اسم الشركة بالإنجليزية', 'Company name in English', { max: 160 })}
              {field('contact_name', 'اسم المسؤول', 'Contact name', { required: true, max: 120 })}
              {field('email', 'البريد الإلكتروني', 'Email', { required: true, type: 'email', max: 254, dir: 'ltr' })}
              {field('phone', 'رقم الهاتف', 'Phone', { type: 'tel', max: 40, dir: 'ltr' })}
            </div>
            <label>{t('رسالة (اختياري)', 'Message (optional)')}<textarea maxLength={2000} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} /></label>
            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
            {state === 'pending' && <p className="form-error" role="alert">{t('يوجد طلب قيد المراجعة بهذا البريد بالفعل.', 'A request with this email is already under review.')}</p>}
            {state === 'error' && <p className="form-error" role="alert">{t('تعذر إرسال الطلب، راجع البيانات وحاول مجددًا.', 'Could not send the request. Check the fields and retry.')}</p>}
            <div className="modal-actions"><button className="primary" disabled={state === 'saving'}>{t('إرسال الطلب', 'Send request')}</button><a className="secondary" href="/auth">{t('لديك حساب؟ تسجيل الدخول', 'Have an account? Sign in')}</a></div>
          </form>
        )}
      </section>
    </main>
  );
}
