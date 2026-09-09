'use client';
import { useState, type FormEvent } from 'react';
import { AdminClient } from './client';
export default function Login({ client, onLogin }: { client: AdminClient; onLogin: () => Promise<void> }) {
  const [challenge, setChallenge] = useState('');
  const [setup, setSetup] = useState<{token:string;secret:string}|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError('');
    try {
      if(setup) { await client.publicRequest('mfa/confirm',{setupToken:setup.token,secret:setup.secret,code:data.get('code')});setSetup(null);setError('เปิด MFA แล้ว กรุณาเข้าสู่ระบบอีกครั้ง'); }
      else if(challenge) { const r=await client.publicRequest<{accessToken:string}>('mfa/verify',{challengeToken:challenge,code:data.get('code')});await client.accept(r.accessToken);await onLogin(); }
      else { const r=await client.publicRequest<{status:string;challengeToken?:string;setupToken?:string}>('login',{email:data.get('email'),password:data.get('password')});
        if(r.challengeToken) setChallenge(r.challengeToken);
        else if(r.setupToken) { const m=await client.publicRequest<{secret:string}>('mfa/setup',{setupToken:r.setupToken});setSetup({token:r.setupToken,secret:m.secret}); }
        else throw new Error('ไม่สามารถเริ่ม session ได้'); }
    } catch(e) {setError(e instanceof Error?e.message:'เข้าสู่ระบบไม่สำเร็จ');} finally {setBusy(false);}
  }
  return <section className="lot-login"><div className="lot-mark">L</div><h1>เข้าสู่ระบบ Admin</h1><p>จัดการการตั้งค่าหวยและการอนุมัติอย่างปลอดภัย</p><form onSubmit={submit}>
    {!challenge&&!setup?<><label>อีเมล<input name="email" type="email" autoComplete="username" required /></label><label>รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label></>:<>
    {setup&&<p>เพิ่ม secret นี้ในแอป Authenticator แล้วกรอกรหัสยืนยัน <code className="lot-secret">{setup.secret}</code></p>}
    <label>รหัส MFA 6 หลัก<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label></>}
    {error&&<p role="alert" className="lot-error">{error}</p>}<button className="lot-primary" disabled={busy}>{busy?'กำลังตรวจสอบ…':challenge||setup?'ยืนยัน MFA':'เข้าสู่ระบบ'}</button>
    {(challenge||setup)&&<button type="button" disabled={busy} onClick={()=>{setChallenge('');setSetup(null);setError('');}}>กลับไปเข้าสู่ระบบ</button>}
  </form></section>;
}
