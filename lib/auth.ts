import { betterAuth } from "better-auth";
import { createPool } from "mysql2/promise";

const database = createPool({
  host: "localhost",
  user: "root",
  password: "password",
  database: "database",
  timezone: "Z",
});

export const auth = betterAuth({
  database: database,
  baseURL: "http://localhost:3000/",
  emailAndPassword: { enabled: true },
});
