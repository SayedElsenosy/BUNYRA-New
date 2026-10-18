'use client';
import { useEffect,useState } from 'react';
import { authClient } from '../../../lib/auth/client';
export default function SignOut(){const [failed,setFailed]=useState(false);useEffect(()=>{void authClient.signOut().then(r=>{if(r.error)setFailed(true);else location.replace('/auth');}).catch(()=>setFailed(true));},[]);return <div className="join-shell"><section className="panel join-card"><h1>BUNYRA</h1><p>{failed?'تعذر تسجيل الخروج. أعد المحاولة.':'جارٍ تسجيل الخروج…'}</p>{failed&&<button className="primary" onClick={()=>location.reload()}>إعادة المحاولة</button>}</section></div>;}
