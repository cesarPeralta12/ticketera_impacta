import Link from "next/link";

/** Cuántas filas o grupos por página en las listas del panel. */
export const PAGE_SIZE = 50;

/** Número de página pedido en la dirección (?pagina=3), entre 1 y `pages`. */
export function pageFrom(raw: string | undefined, pages: number): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), Math.max(pages, 1)) : 1;
}

/**
 * Paginador de una lista: conserva los filtros de la dirección y solo cambia la página. No se dibuja si todo cabe en una.
 */
export function Pager({ path, params, page, total, size = PAGE_SIZE, param = "pagina" }: { path: string; params: Record<string, string | undefined>; page: number; total: number; size?: number; param?: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (n: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
    if (n > 1) search.set(param, String(n));
    const q = search.toString();
    return q ? `${path}?${q}` : path;
  };
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
      <span>
        {from}–{to} de {total}
      </span>
      <span className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn px-3 py-1.5 text-xs">
            ← Anterior
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-xs opacity-40">← Anterior</span>
        )}
        <span>
          Página {page} de {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="btn px-3 py-1.5 text-xs">
            Siguiente →
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-xs opacity-40">Siguiente →</span>
        )}
      </span>
    </nav>
  );
}
