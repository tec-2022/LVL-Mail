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
  app_ids: string[];
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

type AppOption = { id: string; name: string };

type Props = {
  members: Member[];
  apps: AppOption[];
  canManage: boolean;
  currentUserId: string | null;
};

const roleLabels: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

function canBeScoped(role: StaffRole) {
  return role === "operator" || role === "viewer";
}

export function TeamManager({ members, apps, canManage, currentUserId }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const [allApps, setAllApps] = useState(true);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const activeOwners = useMemo(() => members.filter((member) => member.role === "owner" && member.is_enabled).length, [members]);
  const scopedInvite = canBeScoped(role) && !allApps;

  function toggleInviteApp(appId: string) {
    setAppIds((current) => current.includes(appId) ? current.filter((id) => id !== appId) : [...current, appId]);
  }

  async function invite() {
    setBusy("invite");
    setError("");
    try {
      const response = await fetch("/api/admin/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          displayName,
          role,
          allApps: canBeScoped(role) ? allApps : true,
          appIds: canBeScoped(role) && !allApps ? appIds : [],
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo invitar");
      setEmail("");
      setDisplayName("");
      setRole("viewer");
      setAllApps(true);
      setAppIds([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo invitar");
    } finally {
      setBusy("");
    }
  }

  async function update(member: Member, next: { role?: StaffRole; enabled?: boolean; allApps?: boolean; appIds?: string[] }) {
    setBusy(member.user_id);
    setError("");
    const nextRole = next.role ?? member.role;
    const nextAllApps = canBeScoped(nextRole) ? (next.allApps ?? member.all_apps) : true;
    const nextAppIds = nextAllApps ? [] : (next.appIds ?? member.app_ids);
    try {
      const response = await fetch(`/api/admin/team/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: nextRole,
          enabled: next.enabled ?? member.is_enabled,
          allApps: nextAllApps,
          appIds: nextAppIds,
        }),
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
        <label className="field"><span>Rol</span><select value={role} onChange={(event) => { const nextRole = event.target.value as StaffRole; setRole(nextRole); if (!canBeScoped(nextRole)) { setAllApps(true); setAppIds([]); } }}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label>
        <button className="button" disabled={busy === "invite" || !email || (scopedInvite && appIds.length === 0)} onClick={invite}>{busy === "invite" ? "Invitando…" : "Invitar"}</button>
      </div>

      {canBeScoped(role) && <div className="scope-box">
        <div className="scope-head"><div><strong>Scope de aplicaciones</strong><span>Limita lo que este miembro puede consultar y operar.</span></div><select value={allApps ? "all" : "selected"} onChange={(event) => { const global = event.target.value === "all"; setAllApps(global); if (global) setAppIds([]); }}><option value="all">Todas las aplicaciones</option><option value="selected">Solo seleccionadas</option></select></div>
        {!allApps && <div className="scope-options">{apps.map((app) => <label key={app.id}><input type="checkbox" checked={appIds.includes(app.id)} onChange={() => toggleInviteApp(app.id)} /><span><strong>{app.name}</strong><small>{app.id}</small></span></label>)}</div>}
      </div>}
      <p className="help-text">Owner y Admin siempre son globales. Operator y Viewer pueden limitarse a una o varias webs. La invitación no crea registro público.</p>
      {error && <p className="search-error">{error}</p>}
    </section>}

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">STAFF</span><h2>Equipo interno</h2></div><span className="pill neutral">{members.length} miembros · {activeOwners} Owner activos</span></div>
      {error && !canManage && <p className="search-error">{error}</p>}
      <div className="team-list">
        {members.map((member) => {
          const memberBusy = busy === member.user_id;
          const scoped = !member.all_apps;
          return <div className="team-member-card" key={member.user_id}>
            <div className="team-row">
              <div className="team-member"><strong>{member.display_name || member.email}{member.user_id === currentUserId ? " · Tú" : ""}</strong><span>{member.email} · último acceso {member.last_seen_at ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tijuana" }).format(new Date(member.last_seen_at)) : "sin registro"}</span></div>
              <span className={`team-role ${member.role}`}>{roleLabels[member.role]}</span>
              <span className={`team-status ${member.is_enabled ? "enabled" : "disabled"}`}>{member.is_enabled ? "Activo" : "Deshabilitado"}</span>
              <span className={scoped ? "scope-pill scoped" : "scope-pill"}>{scoped ? `${member.app_ids.length} apps` : "Todas las apps"}</span>
              {canManage ? <div className="team-actions"><select className="role-select" value={member.role} disabled={memberBusy} onChange={(event) => update(member, { role: event.target.value as StaffRole, allApps: true, appIds: [] })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button className="secondary-button" disabled={memberBusy || (member.role === "owner" && member.is_enabled && activeOwners <= 1)} onClick={() => update(member, { enabled: !member.is_enabled })}>{member.is_enabled ? "Deshabilitar" : "Reactivar"}</button></div> : <span>Solo lectura</span>}
              <span>{memberBusy ? "…" : ""}</span>
            </div>

            {canManage && canBeScoped(member.role) && <details className="scope-editor">
              <summary>Administrar acceso por aplicación</summary>
              <div className="scope-box compact">
                <div className="scope-head"><div><strong>{member.all_apps ? "Acceso global" : "Acceso limitado"}</strong><span>{member.all_apps ? "Puede consultar todas las webs." : member.app_ids.join(" · ")}</span></div><select disabled={memberBusy} value={member.all_apps ? "all" : "selected"} onChange={(event) => update(member, { allApps: event.target.value === "all", appIds: event.target.value === "all" ? [] : (member.app_ids.length ? member.app_ids : apps.slice(0, 1).map((app) => app.id)) })}><option value="all">Todas las aplicaciones</option><option value="selected">Solo seleccionadas</option></select></div>
                {!member.all_apps && <div className="scope-options">{apps.map((app) => { const checked = member.app_ids.includes(app.id); const nextIds = checked ? member.app_ids.filter((id) => id !== app.id) : [...member.app_ids, app.id]; return <label key={app.id}><input type="checkbox" disabled={memberBusy || (checked && member.app_ids.length === 1)} checked={checked} onChange={() => update(member, { allApps: false, appIds: nextIds })} /><span><strong>{app.name}</strong><small>{app.id}</small></span></label>; })}</div>}
              </div>
            </details>}
          </div>;
        })}
      </div>
    </section>
  </div>;
}
