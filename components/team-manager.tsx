"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffRole } from "@/lib/iam";

type Member = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: StaffRole;
  is_enabled: boolean;
  all_apps: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

type Props = {
  members: Member[];
  canManage: boolean;
  currentUserId: string | null;
};

const roleLabels: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export function TeamManager({ members, canManage, currentUserId }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const activeOwners = useMemo(() => members.filter((member) => member.role === "owner" && member.is_enabled).length, [members]);

  async function invite() {
    setBusy("invite");
    setError("");
    try {
      const response = await fetch("/api/admin/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, role }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo invitar");
      setEmail("");
      setDisplayName("");
      setRole("viewer");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo invitar");
    } finally {
      setBusy("");
    }
  }

  async function update(member: Member, next: { role?: StaffRole; enabled?: boolean }) {
    setBusy(member.user_id);
    setError("");
    try {
      const response = await fetch(`/api/admin/team/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next.role ?? member.role, enabled: next.enabled ?? member.is_enabled }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar");
    } finally {
      setBusy("");
    }
  }

  return <div className="team-manager">
    {canManage && <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">INVITE ONLY</span><h2>Invitar miembro</h2></div><span className="pill success">Owner only</span></div>
      <div className="invite-grid">
        <label className="field"><span>Correo</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@lvltechmx.com" /></label>
        <label className="field"><span>Nombre</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nombre visible" /></label>
        <label className="field"><span>Rol</span><select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label>
        <button className="button" disabled={busy === "invite" || !email} onClick={invite}>{busy === "invite" ? "Invitando…" : "Invitar"}</button>
      </div>
      <p className="help-text">La invitación crea identidad en Supabase Auth y membresía global en LVL Mail. No existe un formulario público de alta.</p>
      {error && <p className="search-error">{error}</p>}
    </section>}

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">STAFF</span><h2>Equipo interno</h2></div><span className="pill neutral">{members.length} miembros · {activeOwners} Owner activos</span></div>
      {error && !canManage && <p className="search-error">{error}</p>}
      <div className="team-list">
        {members.map((member) => <div className="team-row" key={member.user_id}>
          <div className="team-member"><strong>{member.display_name || member.email}{member.user_id === currentUserId ? " · Tú" : ""}</strong><span>{member.email} · último acceso {member.last_seen_at ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tijuana" }).format(new Date(member.last_seen_at)) : "sin registro"}</span></div>
          <span className={`team-role ${member.role}`}>{roleLabels[member.role]}</span>
          <span className={`team-status ${member.is_enabled ? "enabled" : "disabled"}`}>{member.is_enabled ? "Activo" : "Deshabilitado"}</span>
          {canManage ? <div className="team-actions"><select className="role-select" value={member.role} disabled={busy === member.user_id} onChange={(event) => update(member, { role: event.target.value as StaffRole })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button className="secondary-button" disabled={busy === member.user_id || (member.role === "owner" && member.is_enabled && activeOwners <= 1)} onClick={() => update(member, { enabled: !member.is_enabled })}>{member.is_enabled ? "Deshabilitar" : "Reactivar"}</button></div> : <span>Solo lectura</span>}
          <span>{busy === member.user_id ? "…" : ""}</span>
        </div>)}
      </div>
    </section>
  </div>;
}
