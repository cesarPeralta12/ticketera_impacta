import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DEFAULT_TIMEZONE, formatDateTime } from "@ticketera/core";
import { clientAccessOpen, prisma } from "@ticketera/db";
import { ActionForm } from "@/components/action-form";
import { createClientAction } from "@/lib/actions/clients";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientsPage() {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const clients = await prisma.client.findMany({
    where: { organizationId: staff.organization.id },
    orderBy: { name: "asc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, clientAccessEnabled: true, clientAccessUntil: true } },
      memberships: { include: { user: { select: { name: true, email: true, active: true } } } },
    },
  });
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{clients.length} cliente(s)</p>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-[var(--ink-muted)]">
          Productoras u organizadores para los que IMPACTA gestiona eventos. Cada evento se asigna a un cliente; sus
          cuentas (rol cliente, en Usuarios) solo ven esos eventos y solo mientras su espacio esté abierto.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {clients.map((c) => (
          <li key={c.id} className="card p-5">
            <p className="font-medium">{c.name}</p>
            <p className="text-sm text-[var(--ink-muted)]">
              {[c.taxId && `NIT ${c.taxId}`, c.contactEmail].filter(Boolean).join(" · ") || "Sin datos de contacto"}
            </p>
            <p className="eyebrow mt-3">Eventos</p>
            {c.events.length === 0 ? (
              <p className="text-sm text-[var(--ink-dim)]">Ninguno todavía.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {c.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <Link href={`/eventos/${e.id}`} className="hover:text-[var(--accent)]">
                      {e.title}
                    </Link>
                    {clientAccessOpen(e, now) ? (
                      <span className="badge bg-[var(--accent-soft)] text-[var(--accent)]">
                        Espacio abierto hasta {formatDateTime(e.clientAccessUntil!, DEFAULT_TIMEZONE)}
                      </span>
                    ) : (
                      <span className="badge bg-[var(--surface-2)] text-[var(--ink-dim)]">Espacio cerrado</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="eyebrow mt-3">Cuentas</p>
            {c.memberships.length === 0 ? (
              <p className="text-sm text-[var(--ink-dim)]">
                Sin cuentas. Créalas en <Link href="/usuarios" className="underline">Usuarios</Link> con el rol cliente.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {c.memberships.map((m) => (
                  <li key={m.id} className={m.user.active ? "" : "text-[var(--ink-dim)] line-through"}>
                    {m.user.name} <span className="font-mono text-xs text-[var(--ink-dim)]">{m.user.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <section className="card p-6">
        <h2 className="eyebrow mb-4">Nuevo cliente</h2>
        <ActionForm action={createClientAction} resetOnSuccess successMessage="Cliente creado." className="flex flex-wrap items-end gap-3">
          <label className="label">
            Nombre o razón social
            <input name="name" required className="field" />
          </label>
          <label className="label">
            NIT (opcional)
            <input name="taxId" className="field" />
          </label>
          <label className="label">
            Email de contacto (opcional)
            <input name="contactEmail" type="email" className="field" />
          </label>
          <button type="submit" className="btn btn-primary">
            Crear cliente
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
