#!/usr/bin/env python3
"""P03 deployment wiring checks; never contacts production.

1. docker-compose.yml must hand every P03_HANDOFF_* name the formal runtime reads to the backend container
   (except the lab-only P03_HANDOFF_LAB), with defaults that keep the runtime off.
2. dev/p03-prod-readonly-facts.sh must never print a credential value, only whether it is set. The script is run
   against fake ssh/docker/pm2/node binaries so both site branches execute for real on this machine.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ROOT / "docker-compose.yml"
RUNTIME = ROOT / "backend/src/services/artifactHandoff/formalRuntime.js"
FACTS = ROOT / "dev/p03-prod-readonly-facts.sh"
LAB_ONLY = "P03_HANDOFF_LAB"
SECRETS = ("s3cret-ledger-password-0001", "s3cret-client-secret-0002", "s3cret-pm2-password-0003")


def has_compose():
    if not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0


def runtime_names():
    return set(re.findall(r"P03_HANDOFF_[A-Z_]+", RUNTIME.read_text())) - {LAB_ONLY}


@unittest.skipUnless(has_compose(), "docker compose not available")
class ComposeWiringTests(unittest.TestCase):
    def render(self, values):
        with tempfile.TemporaryDirectory() as temp:
            env_file = Path(temp) / "env"
            env_file.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
            # Only PATH/HOME: interpolation must come from the env file, not from this machine's environment.
            done = subprocess.run(
                ["docker", "compose", "--project-directory", str(ROOT), "-f", str(COMPOSE), "--env-file", str(env_file),
                 "config", "--format", "json"],
                env={"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", temp)},
                capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)["services"]["backend"]["environment"]

    def p03(self, environment):
        return {k: v for k, v in environment.items() if k.startswith("P03_HANDOFF_")}

    def test_every_runtime_name_reaches_the_container_and_lab_never_does(self):
        names = set(self.p03(self.render({})))
        self.assertEqual(names, runtime_names())
        self.assertNotIn(LAB_ONLY, names)

    def test_defaults_keep_the_runtime_off(self):
        values = self.p03(self.render({}))
        self.assertEqual(values.pop("P03_HANDOFF_ENABLED"), "")
        # An empty timeout would parse as 0 and fail once enabled, so the runtime's own default is used.
        self.assertEqual(values.pop("P03_HANDOFF_TIMEOUT_MS"), "5000")
        # Trust constants and the ledger account have no defaults: the deployment must state each one.
        self.assertTrue(all(v == "" for v in values.values()), values)

    def test_explicit_values_pass_through_unchanged(self):
        given = {name: f"value-{index}" for index, name in enumerate(sorted(runtime_names()))}
        self.assertEqual(self.p03(self.render(given)), given)


def executable(path, body):
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(0o755)


class ReadonlyFactsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.bin, self.home, self.remote = base / "bin", base / "home", base / "remote"
        for path in (self.bin, self.home, self.remote / "backend"):
            path.mkdir(parents=True)
        # The remote checkout: a real git repository plus a backend/.env holding credential values.
        subprocess.run(["git", "init", "-q"], cwd=self.remote, check=True)
        (self.remote / "README").write_text("x\n")
        subprocess.run(["git", "add", "README"], cwd=self.remote, check=True)
        subprocess.run(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qm", "x"],
                       cwd=self.remote, check=True)
        (self.remote / "backend/.env").write_text(
            "IDENTITY_ENABLED=true\n"
            f"IDENTITY_CLIENT_SECRET={SECRETS[1]}\n"
            "P03_HANDOFF_ENABLED=false\n"
            "P03_HANDOFF_DB_USER=p03_handoff\n"
            f"P03_HANDOFF_DB_PASSWORD={SECRETS[0]}\n")
        # ssh runs the remote command locally; stdin (the remote script) passes straight through.
        executable(self.bin / "ssh", 'exec bash -c "${!#}"\n')
        executable(self.bin / "node", 'echo \'{"fake":"db"}\'\n')
        executable(self.bin / "pm2", f'''
case "$1" in
  id) echo "[ 0 ]";;
  env) printf '%s\\n' "IDENTITY_ENABLED: true" "P03_HANDOFF_ENABLED: false" "P03_HANDOFF_DB_PASSWORD: {SECRETS[2]}";;
esac
''')
        executable(self.bin / "docker", f'''
[ "$1 $2" = "compose exec" ] || exit 1
for arg in "$@"; do case "$arg" in NODE_FACTS=*) echo '{{"fake":"db"}}'; exit 0;; esac; done
exec env -i PATH="$PATH" IDENTITY_ENABLED=true IDENTITY_CLIENT_SECRET={SECRETS[1]} \\
  P03_HANDOFF_ENABLED= P03_HANDOFF_TIMEOUT_MS=5000 P03_HANDOFF_STORE=mysql \\
  P03_HANDOFF_DB_USER=p03_handoff P03_HANDOFF_DB_PASSWORD={SECRETS[0]} P03_HANDOFF_LAB= sh -c "${{!#}}"
''')
        self.env = {"PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}", "HOME": str(self.home),
                    "REMOTE_DIR": str(self.remote)}

    def run_facts(self, site):
        done = subprocess.run(["bash", str(FACTS), site], env=self.env, capture_output=True, text=True, timeout=60)
        output = done.stdout + done.stderr
        for secret in SECRETS:
            self.assertNotIn(secret, output)
        return output

    def test_pku_reports_presence_and_public_values_only(self):
        output = self.run_facts("pku")
        for line in ("P03_HANDOFF_DB_PASSWORD=<set>", "P03_HANDOFF_DB_USER=<set>", "IDENTITY_CLIENT_SECRET=<set>",
                     "P03_HANDOFF_LAB=<unset>", "IDENTITY_CREDENTIALS_FILE=<unset>",
                     "P03_HANDOFF_TIMEOUT_MS=5000", "P03_HANDOFF_STORE=mysql", '{"fake":"db"}'):
            self.assertIn(line, output)

    def test_practice_reports_presence_for_env_file_and_pm2(self):
        output = self.run_facts("practice")
        for line in ("P03_HANDOFF_DB_PASSWORD=<set>", "IDENTITY_CLIENT_SECRET=<set>", "P03_HANDOFF_ENABLED=false",
                     "P03_HANDOFF_DB_PASSWORD: <set>", "P03_HANDOFF_ENABLED: false", '{"fake":"db"}'):
            self.assertIn(line, output)


if __name__ == "__main__":
    unittest.main()
