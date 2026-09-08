import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { supabaseAuthConfigured } from "@/lib/supabase/auth-server";

export const metadata = { title: "Acceso" };

export default function LoginPage() {
  const configured = supabaseAuthConfigured();
  return <main className="login-shell">
    <section className="login-card">
      <div className="login-brand"><div className="brand-mark">✉</div><div><strong>LVL Mail</strong><span>Control plane</span></div></div>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Acceso interno</h1>
      <p>Solo miembros invitados del equipo LVL Tech pueden entrar. No existe registro público para esta consola.</p>
      {configured ? <Suspense fallback={<div className="login-loading">Cargando acceso…</div>}><LoginForm /></Suspense> : <div className="login-notice"><strong>IAM todavía no está conectado.</strong><span>Mientras preparamos producción, el acceso de emergencia continúa mediante la credencial break-glass existente.</span></div>}
      <div className="login-security"><span>Sesión SSR con cookies</span><span>Roles verificados en servidor</span><span>Sin registro público</span></div>
    </section>
  </main>;
}
