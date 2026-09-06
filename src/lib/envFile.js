const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", "..", ".env");

// Updates (or appends) a single KEY=value line in .env, preserving every
// other line untouched, then applies it to the running process immediately
// so it takes effect without a restart.
function setEnvVar(key, value) {
  let content = "";
  try {
    content = fs.readFileSync(ENV_PATH, "utf-8");
  } catch {
    content = "";
  }

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.replace(/\n?$/, "\n") + line + "\n";
  }

  fs.writeFileSync(ENV_PATH, content, "utf-8");
  process.env[key] = value;
}

module.exports = { setEnvVar };
