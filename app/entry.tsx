'use client';
import { useEffect, useState } from 'react';
import BunyraBrand from './bunyra-brand';
import Console from './console';
import { Building2, Globe, Moon, Sun, ShieldCheck, FolderKanban, LogOut } from 'lucide-react';

type Session = { user: { name: string; email: string }; is_owner: boolean; companies: { id: string; name: string; name_en: string; role: string }[] };
type Workspace = { company: { id: string; name: string; name_en: string }; projects: { id: string; name: string }[]; can_manage_members: boolean };
import CompanyNavigation,{type CompanyView} from './company-navigation';
import CompanyWorkspace from './company-workspace';

export default function Entry({ portal }: { portal?: 'owner' | 'company' }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<CompanyView>('projects');
  const [en, setEn] = useState(false);
  const [dark, setDark] = useState(false);
  const t = (ar: string, eng: string) => en ? eng : ar;

  useEffect(() => {
    setEn(localStorage.getItem('bunyra-language') === 'en');
    setDark(localStorage.getItem('bunyra-theme') === 'dark');
    void fetch('/api/session').then(async response => {
      const data = await response.json() as Session & { error?: string };
      if (!response.ok) {
        if (data.error === 'PASSWORD_CHANGE_REQUIRED') { location.assign('/account'); return; }
        throw new Error(data.error);
      }
      if (portal && ((portal === 'owner') !== data.is_owner)) { location.replace(data.is_owner ? '/owner' : '/company'); return; }
      setSession(data);
      if (data.companies.length) setSelected(data.companies[0].id);
    }).catch(e => setError(e instanceof Error ? e.message : 'SERVICE_UNAVAILABLE')).finally(() => setLoading(false));
  }, [portal]);

  useEffect(() => {
    document.documentElement.lang = en ? 'en' : 'ar';
    document.documentElement.dir = en ? 'ltr' : 'rtl';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('bunyra-language', en ? 'en' : 'ar');
    localStorage.setItem('bunyra-theme', dark ? 'dark' : 'light');
  }, [en, dark]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setWorkspace(null);
    setView('projects');
    setError('');
    void fetch(`/api/company?id=${selected}`).then(async response => {
      const data = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(data.error);
      if (live) setWorkspace(data);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'SERVICE_UNAVAILABLE'); });
    return () => { live = false; };
  }, [selected]);

  if (session?.is_owner) return <Console />;
  return <div className={session?"tenant-shell has-workspace":"tenant-shell"}>
    {session&&<aside className="sidebar tenant-sidebar"><a className="brand" href="/company"><BunyraBrand dark /></a><div className="workspace"><span className="workspace-icon"><Building2 size={21}/></span><div><strong>{workspace?.company.name||t('مساحة الشركة','Company workspace')}</strong><small>{t('حساب الشركة','Company account')}</small></div></div><p className="nav-label">{t('مساحة العمل','WORKSPACE')}</p><CompanyNavigation view={view} onChange={setView} en={en} canManageMembers={workspace?.can_manage_members||false}/><div className="side-bottom"><div className="foundation"><span className="mini-dot"/>{t('مساحة عمل متصلة','Connected workspace')}<p>{t('مشروعاتك وفريقك في مكان واحد','Your projects and team in one place')}</p></div><a className="profile" href="/auth/sign-out?portal=company"><span className="avatar">{session.user.name?.slice(0,1)||'B'}</span><div><strong>{session.user.name}</strong><small>{t('تسجيل الخروج','Sign out')}</small></div><LogOut size={17}/></a></div></aside>}
    <header className="topbar"><a href="/" className="tenant-brand"><BunyraBrand dark={dark}/></a><div className="top-actions"><button className="icon-button" aria-label={t('تغيير اللغة', 'Change language')} onClick={() => setEn(!en)}><Globe size={18} />{en ? 'ع' : 'EN'}</button><button className="icon-button" aria-label={t('تغيير المظهر', 'Change theme')} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>{session && <a href="/auth/sign-out?return_to=%2F" target="_top" className="icon-button" aria-label={t('تسجيل الخروج', 'Sign out')}><LogOut size={18} /></a>}</div></header>
    <main className="tenant-main"><div className="eyebrow">BUNYRA · WORKSPACE</div><h1>{session ? t('مساحة عمل الشركة', 'Company workspace') : t('أهلاً بك في BUNYRA', 'Welcome to BUNYRA')}</h1>
      {loading ? <div className="loading">{t('جارٍ التحقق من الحساب…', 'Checking your account…')}</div> : error ? <div className="error-panel"><ShieldCheck size={35} /><h2>{error === 'UNAUTHORIZED' ? t('اختر بوابة الدخول', 'Choose your sign-in portal') : error === 'FORBIDDEN' ? t('ليس لديك وصول نشط إلى هذه الشركة', 'No active access to this company') : t('تعذر الاتصال بالخدمة', 'Service unavailable')}</h2>{error === 'UNAUTHORIZED' ? <><a className="primary" href={portal === 'owner' ? '/owner/login' : '/company/login'} target="_top">{portal === 'owner' ? t('دخول إدارة المنصة', 'Platform owner sign in') : t('دخول الشركات', 'Company sign in')}</a>{!portal && <a className="secondary" href="/owner/login">{t('دخول إدارة المنصة', 'Platform owner sign in')}</a>}</> : <button className="secondary" onClick={() => location.reload()}>{t('إعادة المحاولة', 'Retry')}</button>}</div> : session && !session.companies.length ? <section className="panel empty"><Building2 size={32} /><h2>{t('لم تنضم إلى شركة بعد', 'No company memberships yet')}</h2><p>{t('تواصل مع إدارة المنصة لربط حسابك بالشركة.', 'Contact the platform administrator to link your account to a company.')}</p><small dir="ltr">{session.user.email}</small></section> : <>
        <div className="workspace-toolbar"><label>{t('الشركة الحالية', 'Current company')}<select value={selected} onChange={e => setSelected(e.target.value)}>{session?.companies.map(c => <option value={c.id} key={c.id}>{en ? c.name_en || c.name : c.name}</option>)}</select></label><span dir="ltr">{session?.user.email}</span></div>
        {workspace ? <><div className="context-banner"><ShieldCheck size={18} />{t('تعرض هذه المساحة بيانات الشركة المحددة وفق عضويتك وصلاحياتك.', 'This workspace shows the selected company according to your membership and permissions.')}</div><CompanyWorkspace key={selected} companyId={selected} en={en} view={view}/></> : <div className="loading">{t('جارٍ تحميل الشركة…', 'Loading company…')}</div>}
      </>}
      <footer>BUNYRA <span>ERP & CRM</span></footer>
    </main>
  </div>;
}
