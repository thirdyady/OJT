// Run only on a trusted custodian machine. No browser or service-role reset endpoint.
import postgres from "postgres";
if (!process.stdin.isTTY || !process.env.DTR_CUSTODIAN_DATABASE_URL)
  throw new Error("An interactive terminal and DTR_CUSTODIAN_DATABASE_URL are required.");
async function hidden(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (buffer) => {
      for (const c of buffer.toString("utf8")) {
        if (c === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (c === "\r" || c === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("data", onData);
  });
}
console.log(
  "This installs a temporary Chief password and invalidates prior approvals and recovery codes. It requires database-owner access. No attendance records are changed.",
);
const confirmation = await hidden("Type INSTALL to continue: ");
if (confirmation !== "INSTALL") process.exit(1);
let password = await hidden("Temporary Chief password (hidden): ");
let confirm = await hidden("Confirm temporary password (hidden): ");
if (password !== confirm || password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
  throw new Error("Passwords must match, be at least 12 characters and at most 72 UTF-8 bytes.");
let sql;
try {
  sql = postgres(process.env.DTR_CUSTODIAN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const [{ recovery }] = await sql`SELECT dtr_private.generate_chief_recovery_code() AS recovery`;
  await sql`INSERT INTO dtr_private.chief_secret(singleton,password_hash,recovery_hash,must_change) VALUES(true,extensions.crypt(${password},extensions.gen_salt('bf',12)),extensions.crypt(dtr_private.normalize_chief_recovery_code(${recovery}),extensions.gen_salt('bf',12)),false) ON CONFLICT(singleton) DO UPDATE SET password_hash=EXCLUDED.password_hash,recovery_hash=EXCLUDED.recovery_hash,must_change=false,version=dtr_private.chief_secret.version+1`;
  password = "";
  confirm = "";
  console.log(
    "Initial password installed. The Chief may change it in Settings at any time. Store this one-time recovery code securely:",
  );
  console.log(recovery);
} catch {
  console.error("Setup was not confirmed. Check the private schema and database-owner connection.");
  process.exitCode = 1;
} finally {
  password = "";
  confirm = "";
  if (sql) await sql.end();
}
