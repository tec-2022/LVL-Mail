import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { TeamManager } from "@/components/team-manager";
import { getPagePrincipal, hasPermission, listStaffMembers, rolePermissionList } from "@/lib/iam";
import { listAccessAudit } from "@/lib/access-audit";

export const metadata = { title: "Equipo" };

function date(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tijuana" }).format(new Date(value));
}

export default async function TeamPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  if (!hasPermission(principal.role, "team.read")) redirect("/");

  const canManage = hasPermission(principal.role, "team.manage");
  const canAudit = hasPermission(principal.role, "audit.read");
  const [members, accessAudit] = await Promise.all([
    listStaffMembers(),
    canAudit ? listAccessAudit(80) : Promise.resolve([]),
  ]);

  return <AppShell active="Equipo" requiredPermission="team.read">
    <PageHeader eyebrow="Identity & Access" title="Equipo y permisos" description="Acceso interno invite-only con roles server-side. Los cambios de rol o estado aplican en la siguiente solicitud privilegiada." />
    <section className="metrics-grid">
      <article className="metric-card featured"><span>Tu rol</span><strong style={{textTransform:"capitalize"}}>{principal.role}</strong><small>{principal.kind === "break_glass" ? "Acceso de emergencia temporal" : "Membresía verificada en servidor"}</small></article>
      <article className="metric-card"><span>Miembros</span><strong>{members.length}</strong><small>{members.filter((member) => member.is_enabled).length} activos</small></article>
      <article className="metric-card"><span>Owner activos</span><strong>{members.filter((member) => member.role === "owner" && member.is_enabled).length}</strong><small>El último Owner está protegido por DB</small></article>
      <article className="metric-card"><span>Registro público</span><strong>No</strong><small>Solo invitaciones de Owner</small></article>
    </section>

    <TeamManager members={members} canManage={canManage} currentUserId={principal.userId} />

    <section className="panel" style={{marginTop:"14px"}}>
      <div className="panel-head"><div><span className="eyebrow">RBAC</span><h2>Permisos de tu rol</h2></div><span className="pill neutral">{rolePermissionList(principal.role).length} permisos</span></div>
      <div className="permission-grid">{rolePermissionList(principal.role).map((permission) => <div className="permission-item" key={permission}><code>{permission}</code></div>)}</div>
    </section>

    {canAudit && <section className="panel" style={{marginTop:"14px"}}>
      <div className="panel-head"><div><span className="eyebrow">ACCESS AUDIT</span><h2>Acciones privilegiadas</h2></div><span className="pill neutral">Últimas {accessAudit.length}</span></div>
      {accessAudit.length === 0 ? <div className="empty-state"><h2>Sin auditoría todavía</h2><p>Las invitaciones, cambios de rol, búsquedas, publicaciones, incidentes, keys y replays aparecerán aquí cuando la persistencia IAM esté conectada.</p></div> : <div className="team-list">{accessAudit.map((entry) => <div className="team-row" key={entry.id}><div className="team-member"><strong>{entry.action}</strong><span>{entry.actor_email ?? "system"} · {entry.permission}</span></div><span className={`team-role ${entry.actor_role ?? "viewer"}`}>{entry.actor_role ?? "system"}</span><span className="team-status enabled">{entry.app_id ?? "global"}</span><time dateTime={entry.created_at}>{date(entry.created_at)}</time><span/></div>)}</div>}
    </section>}
  </AppShell>;
}
