import fs from 'fs';

// Credentials never come from plain env vars: they are read from Docker secrets
// (/run/secrets/<name>) or from the file named by <NAME>_FILE.
export function readSecret(name: string): string {
  const file = process.env[`${name.toUpperCase()}_FILE`] || `/run/secrets/${name}`;
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`Missing secret "${name}" (expected at ${file})`);
  }
}
