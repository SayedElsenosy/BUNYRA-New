import {redirect} from 'next/navigation';
import {getCurrentUser} from '../../lib/auth/current-user';
import {getDb} from '../../db';
import {owner} from '../../lib/bunyra/service';
import AccountForm from '../account-form';
export const dynamic='force-dynamic';
export const metadata={title:'BUNYRA | حساب مالك المنصة'};
export default async function OwnerAccount(){const user=await getCurrentUser();if(!user)redirect('/owner/login');if(!await owner(getDb(),user))redirect('/company');return <AccountForm/>;}
