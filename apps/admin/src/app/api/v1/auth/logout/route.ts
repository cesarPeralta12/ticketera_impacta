import { authenticateDevice, endDeviceSession, recordAuditSafely } from "@ticketera/db";
import { json, mobileContext } from "@/lib/mobile-auth";

export async function POST(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (token) {
    const staff = await authenticateDevice(token);
    await endDeviceSession(token);
    if (staff) {
      await recordAuditSafely({
        actorType: "staff",
        actorId: staff.id,
        action: "auth.logout",
        entity: "DeviceToken",
        entityId: staff.deviceTokenId,
        context: { ...mobileContext(req), deviceId: staff.deviceId, deviceName: staff.deviceName },
      });
    }
  }
  return json({ ok: true });
}
