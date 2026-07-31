import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "plant-service");
const python =
  process.platform === "win32"
    ? path.join(serviceDir, ".venv", "Scripts", "python.exe")
    : path.join(serviceDir, ".venv", "bin", "python");

const child = spawn(
  python,
  ["-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "8001"],
  { cwd: serviceDir, stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
