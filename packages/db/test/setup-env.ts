import { testDatabaseUrls } from "./test-db";

// Se ejecuta en cada worker antes de importar los tests: el cliente Prisma lee esta URL.
process.env.DATABASE_URL = testDatabaseUrls().test;
process.env.TICKET_QR_SECRET ??= "secreto-de-pruebas";
