'use client';
import {useState,type InputHTMLAttributes} from 'react';
export default function LocalizedFilePicker({en=false,onChange,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'> & {en?:boolean}){
 const [name,setName]=useState('');
 return <span className={'localized-file-picker'+(props.disabled?' disabled':'')}>
  <input {...props} type="file" onChange={event=>{setName(Array.from(event.target.files||[]).map(file=>file.name).join(', '));onChange?.(event);}}/>
  <span className="file-picker-control">{en?'Choose file':'اختيار ملف'}</span>
  <bdi className="file-picker-name">{name||(en?'No file selected':'لم يتم اختيار ملف')}</bdi>
 </span>;
}
