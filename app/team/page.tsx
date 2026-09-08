import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { TeamManager } from "@/components/team-manager";
import { getPagePrincipal, hasPermission, listStaffMembers, rolePermissionList } from "@/lib/iam";

export const metadata = { title: "Equipo" };

export default async function TeamPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  if (!hasPermission(principal.role, "team.read")) redirect("/");

  const members = await listStaffMembers();
  const canManage = hasPermission(principal.role, "team.manage");

  return <AppShell active="Equipo">
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
  </AppShell>;
}
