import { RESET_PASSWORD_MINUTES, requestStaffPasswordReset } from "@ticketera/db";
import { passwordChangedMessage, resetPasswordMessage, sendEmailSafely } from "@ticketera/mail";

const baseUrl = () => (process.env.ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");

/** "Olvidé mi contraseña" del personal del panel. Quien lo pide nunca sabe si la cuenta existía. */
export async function sendStaffResetEmail(email: string) {
  const issued = await requestStaffPasswordReset(email);
  if (issued.status !== "SENT") return;
  await sendEmailSafely(
    resetPasswordMessage({
      to: issued.email,
      name: issued.name,
      link: `${baseUrl()}/restablecer?token=${issued.token}`,
      minutes: RESET_PASSWORD_MINUTES,
    }),
  );
}

export async function sendStaffPasswordChangedEmail(to: string, name: string) {
  await sendEmailSafely(passwordChangedMessage({ to, name }));
}
