// tsc does not copy .sql files; migrations ship next to the compiled migrate runner.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'db', 'migrations');
const dest = path.join(__dirname, '..', 'dist', 'db', 'migrations');
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.sql'))) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
