import { redirect } from "next/navigation";

/** La validación en puerta ahora vive en la app dedicada /puerta. */
export default function AccessRedirect() {
  redirect("/puerta");
}
