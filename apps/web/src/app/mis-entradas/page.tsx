import { permanentRedirect } from "next/navigation";

/** La sección ahora se llama "Mis eventos": los enlaces viejos siguen funcionando. */
export default function OldMyTicketsPage() {
  permanentRedirect("/mis-eventos");
}
