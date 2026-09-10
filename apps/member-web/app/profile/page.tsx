"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "../components/auth-shell";
import { memberApi } from "../lib/member-api";

const defaultProfile = { name: "", birthdate: "", province: "กรุงเทพมหานคร" };

export default function OnboardingProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(defaultProfile);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    Promise.all([memberApi.getTerms(), memberApi.getProfile()])
      .then(([terms, currentProfile]) => {
        setTermsAccepted(terms.satisfied);
        setProfile({
          name: currentProfile.fullName ?? "",
          birthdate: currentProfile.dateOfBirth ?? "",
          province: currentProfile.province ?? "กรุงเทพมหานคร",
        });
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลสมาชิกไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!termsAccepted) return setError("ต้องยอมรับข้อตกลงก่อนกรอกข้อมูลสมาชิกในลำดับ onboarding");
    if (!profile.name.trim() || !profile.birthdate || !profile.province) return setError("กรอกข้อมูลที่จำเป็นให้ครบ");
    setSubmitting(true);
    setError("");
    try {
      const result = await memberApi.updateProfile({
        fullName: profile.name.trim(),
        dateOfBirth: profile.birthdate,
        province: profile.province,
      });
      if (!result.profileComplete) {
        setError("ข้อมูลที่จำเป็นยังไม่ครบ กรุณาตรวจข้อมูลอีกครั้ง");
        return;
      }
      try { window.localStorage.setItem("lottify-onboarding-profile", "complete"); } catch {}
      router.push("/eligibility");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลสมาชิกไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title={<>ข้อมูลที่จำเป็น<br />ก่อนเริ่มใช้งาน</>} copy="กรอกข้อมูลพื้นฐานเพื่อประเมินสิทธิ์ของแต่ละบริการ การสร้างบัญชีสำเร็จไม่ได้หมายความว่าทุกบริการจะเปิดใช้โดยอัตโนมัติ" foot="ขั้นตอน 4 จาก 5 · ข้อมูลพื้นฐาน">
    <form className="auth-card" onSubmit={submit}><h2>ข้อมูลสมาชิก</h2><p>{loading ? "กำลังโหลดข้อมูลจากบัญชี…" : "ข้อมูลพื้นฐานที่ใช้ประเมินความพร้อมของบริการ"}</p>{!loading && !termsAccepted && <div className="notice warning"><b>!</b><div><strong>ลำดับ onboarding ยังไม่ครบ</strong><Link className="text-link" href="/terms"> กลับไปยอมรับข้อตกลง →</Link></div></div>}<div className="form-grid"><div className="field full"><label htmlFor="onboarding-name">ชื่อ-นามสกุล</label><input id="onboarding-name" className="input" autoComplete="name" disabled={loading || submitting} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></div><div className="field"><label htmlFor="onboarding-birthdate">วันเกิด</label><input id="onboarding-birthdate" className="input" type="date" disabled={loading || submitting} value={profile.birthdate} onChange={(event) => setProfile({ ...profile, birthdate: event.target.value })} /></div><div className="field"><label htmlFor="onboarding-province">จังหวัด</label><select id="onboarding-province" className="select" disabled={loading || submitting} value={profile.province} onChange={(event) => setProfile({ ...profile, province: event.target.value })}><option>กรุงเทพมหานคร</option><option>ปทุมธานี</option><option>นนทบุรี</option>{profile.province && !["กรุงเทพมหานคร", "ปทุมธานี", "นนทบุรี"].includes(profile.province) && <option>{profile.province}</option>}</select></div></div><div className="notice info" style={{ marginTop: 16 }}><b>i</b><div><strong>KYC ไม่ได้บังคับในขั้นตอนสมัคร</strong>หากบริการบางอย่างต้องยืนยันตัวตน ระบบจะแจ้งเมื่อคุณกำลังใช้บริการนั้น</div></div><div className="field-error">{error}</div><button className={`button lime block ${termsAccepted && !loading && !submitting ? "" : "disabled"}`} type="submit" disabled={!termsAccepted || loading || submitting} style={{ marginTop: 18 }}>{submitting ? "กำลังบันทึก…" : "บันทึกและตรวจความพร้อม →"}</button></form>
  </AuthShell>;
}
