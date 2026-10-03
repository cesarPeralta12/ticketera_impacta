import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getEventReport, prisma } from "@ticketera/db";
import { EventReport } from "@/components/event-report";
import { PrintButton } from "@/components/print-button";
import { MODE_LABEL } from "@/lib/labels";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Reporte" };

type Props = { params: Promise<{ id: string }> };

export default async function EventReportPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.manage);
  const owned = await prisma.event.findFirst({
    where: { id: (await params).id, organizationId: staff.organization.id },
    select: { id: true },
  });
  if (!owned) notFound();
  const report = (await getEventReport(owned.id))!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/eventos/${owned.id}`} className="text-sm text-[var(--ink-dim)] hover:text-[var(--ink)] print:hidden">
            ← {report.event.title}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Reporte · {report.event.title}</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {MODE_LABEL[report.event.mode]}
            {report.event.client ? ` · Cliente: ${report.event.client.name}` : ""} · venta online, boletería e
            invitaciones juntas, desde la base central.
          </p>
        </div>
        <PrintButton />
      </div>
      <EventReport report={report} csvHref={`/eventos/${owned.id}/reporte/csv`} />
    </div>
  );
}
