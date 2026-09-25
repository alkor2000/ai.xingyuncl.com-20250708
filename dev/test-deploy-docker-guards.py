#!/usr/bin/env python3
"""Isolated release-script regression checks; never contacts production."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PREFLIGHT = HERE / "docker-release-preflight.sh"
DEPLOY = HERE / "deploy-docker.sh"


def executable(path, body):
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(0o755)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bin = Path(self.temp.name)
        executable(self.bin / "docker", '''
case "$*" in
  *"{{.Config.Image}}"*) case "$*" in *backend*) echo "ai-platform-backend:${BACKEND_TAG}";; *) echo "ai-platform-frontend:${FRONTEND_TAG}";; esac;;
  *"{{.State.Health.Status}}"*) echo "${CONTAINER_HEALTH}";;
  *"{{.State.Running}}"*) echo "${CONTAINER_RUNNING}";;
  *"{{.State.Paused}}"*) echo "${CONTAINER_PAUSED}";;
  *"{{.State.Restarting}}"*) echo "${CONTAINER_RESTARTING}";;
  *"{{.Image}}"*) echo "${RUNNING_ID}";;
  *"{{.Id}}"*) echo "${TAGGED_ID}";;
esac
''')
        executable(self.bin / "df", '''
case "$*" in
  *"--output=avail"*) printf 'Avail\\n%s\\n' "${FAKE_DISK}";;
  *"--output=iavail"*) printf 'IAvail\\n%s\\n' "${FAKE_INODES}";;
esac
''')
        executable(self.bin / "free", '''
printf '              total used free shared buff/cache available\\nMem: 100000 0 0 0 0 %s\\n' "${FAKE_MEMORY}"
''')
        self.env = os.environ | {
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "BACKEND_TAG": "v-abcdef0-20260924_010000",
            "FRONTEND_TAG": "v-abcdef0-20260924_010000",
            "CONTAINER_HEALTH": "healthy",
            "CONTAINER_RUNNING": "true",
            "CONTAINER_PAUSED": "false",
            "CONTAINER_RESTARTING": "false",
            "RUNNING_ID": "sha256:same",
            "TAGGED_ID": "sha256:same",
            "FAKE_DISK": str(10 * 1024**3),
            "FAKE_INODES": "200000",
            "FAKE_MEMORY": str(3 * 1024**3),
        }

    def run_check(self, *args, **overrides):
        return subprocess.run(["bash", str(PREFLIGHT), *args], env=self.env | overrides,
                              text=True, capture_output=True)

    def test_runtime_requires_both_actual_healthy_target_images(self):
        self.assertEqual(self.run_check("runtime", "abcdef0").stdout.strip(), "CURRENT")
        self.assertIn("STALE frontend", self.run_check(
            "runtime", "abcdef0", FRONTEND_TAG="v-1234567-20260923_010000").stdout)
        self.assertIn("STALE backend", self.run_check(
            "runtime", "abcdef0", CONTAINER_HEALTH="unhealthy").stdout)
        self.assertIn("STALE backend", self.run_check(
            "runtime", "abcdef0", RUNNING_ID="sha256:old").stdout)

    def test_resource_gate_rejects_low_and_unknown_values(self):
        self.assertEqual(self.run_check("resources", "8", "2048", "100000").returncode, 0)
        self.assertNotEqual(self.run_check("resources", "8", "2048", "100000",
                                           FAKE_DISK=str(7 * 1024**3)).returncode, 0)
        self.assertNotEqual(self.run_check("resources", "8", "2048", "100000",
                                           FAKE_INODES="unknown").returncode, 0)
        self.assertNotEqual(self.run_check("resources", "8", "2048", "100000",
                                           FAKE_MEMORY=str(1024**3)).returncode, 0)
        self.assertNotEqual(self.run_check("resources", "8", "2048", "100000",
                                           FAKE_DISK=str(73 * 1024**3 // 10)).returncode, 0)

    def test_residual_healthy_does_not_hide_stopped_paused_or_restarting(self):
        for change in ({"CONTAINER_RUNNING": "false"},
                       {"CONTAINER_PAUSED": "true"},
                       {"CONTAINER_RESTARTING": "true"},
                       {"CONTAINER_RUNNING": "unknown"}):
            with self.subTest(change=change):
                result = self.run_check("runtime", "abcdef0", **change)
                self.assertIn("STALE backend", result.stdout)


class ReleaseOrderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo = base / "repo"
        self.repo.mkdir()
        (self.repo / "dev").mkdir()
        (self.repo / "dev" / "deploy-docker.sh").write_bytes(DEPLOY.read_bytes())
        (self.repo / "dev" / "docker-release-preflight.sh").write_bytes(PREFLIGHT.read_bytes())
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=self.repo, check=True)
        subprocess.run(["git", "add", "dev"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "base"], cwd=self.repo, check=True)
        self.old_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repo, text=True).strip()
        (self.repo / "change.txt").write_text("next\n")
        subprocess.run(["git", "add", "change.txt"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "next"], cwd=self.repo, check=True)
        self.new_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repo, text=True).strip()
        bare = base / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        subprocess.run(["git", "remote", "add", "origin", str(bare)], cwd=self.repo, check=True)
        subprocess.run(["git", "push", "-q", "origin", "main"], cwd=self.repo, check=True)
        self.trace = base / "trace"
        fake_bin = base / "bin"
        fake_bin.mkdir()
        executable(fake_bin / "ssh", '''
echo "ssh $*" >> "$TRACE"
case "$*" in
  *"git status --porcelain"*) echo 0;;
  *"git rev-parse HEAD"*) if [[ "$*" == *"fake-pm2"* ]]; then echo "$FAKE_LOCAL_SHA"; else echo "$FAKE_REMOTE_SHA"; fi;;
  *"bash -s"*) cat >/dev/null
    if [[ "$*" == *" runtime "* ]]; then echo "STALE backend image=old"; exit 0; fi
    if [[ "$*" == *" resources "* ]]; then echo "insufficient build resources" >&2; exit 1; fi
    exit 99;;
esac
''')
        executable(fake_bin / "scp", 'echo scp >> "$TRACE"; exit 99\n')
        executable(fake_bin / "curl", 'exit 0\n')
        self.env = os.environ | {
            "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
            "TRACE": str(self.trace),
            "PM2_SSH_HOST": "fake-pm2",
            "DOCKER_SSH_HOST": "fake-docker",
            "FAKE_LOCAL_SHA": self.new_sha,
        }

    def run_deploy(self, remote_sha):
        return subprocess.run(["bash", "dev/deploy-docker.sh", "-y"], cwd=self.repo,
                              env=self.env | {"FAKE_REMOTE_SHA": remote_sha},
                              text=True, capture_output=True)

    def test_same_git_but_stale_container_cannot_report_success(self):
        result = self.run_deploy(self.new_sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("runtime", self.trace.read_text())
        self.assertIn("resources", self.trace.read_text())

    def test_low_resources_stop_before_code_transfer(self):
        result = self.run_deploy(self.old_sha)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("resources", self.trace.read_text())
        self.assertNotIn("scp", self.trace.read_text())


class RemoteSuccessCleanupTests(unittest.TestCase):
    """Run the successful remote path against fake commands, never Docker or SSH."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.remote = base / "remote"
        (self.remote / "dev").mkdir(parents=True)
        executable(self.remote / "dev" / "docker-release-preflight.sh", '''
if [ "$1" = runtime ]; then echo CURRENT; fi
''')
        self.bin = base / "bin"
        self.bin.mkdir()
        self.trace = base / "docker-trace"
        executable(self.bin / "docker", '''
echo "docker $*" >> "$TRACE"
if [[ "$1" == image && "$2" == inspect ]]; then echo sha256:old; exit 0; fi
if [[ "$1" == inspect ]]; then
  if [[ "$*" == *"{{.Config.Image}}"* ]]; then
    case "$*" in *backend*) echo ai-platform-backend:v-old;; *) echo ai-platform-frontend:v-old;; esac
  elif [[ "$*" == *"{{.State.Health.Status}}"* ]]; then echo healthy
  elif [[ "$*" == *"{{.Image}}"* ]]; then echo sha256:running
  fi
  exit 0
fi
if [[ "$1" == exec ]]; then echo 'CREATE TABLE fake_backup (id INT);'; exit 0; fi
if [[ "$1" == images ]]; then
  for n in 1 2 3 4; do echo "v-abcdef0-2026092${n}_010000"; done
  for n in 1 2 3 4; do echo "rollback-2026092${n}_010000"; done
  exit 0
fi
if [[ "$1" == ps ]]; then echo 'ai-platform-backend running'; exit 0; fi
if [[ "$1" == compose && " $* " == *" run "* ]]; then echo 'migration applied'; exit 0; fi
exit 0
''')
        executable(self.bin / "git", '''
if [[ "$*" == 'rev-parse HEAD' ]]; then echo abcdef0123456789; fi
''')
        self.env = os.environ | {
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "TRACE": str(self.trace),
        }
        self.backups = base / "backups"

    def run_remote(self, add_unsafe_prune=False):
        script = DEPLOY.read_text()
        marker = '<<\'REMOTE\' | tee "$REMOTE_LOG"\n'
        start = script.index(marker) + len(marker)
        end = script.index("\nREMOTE\n", start)
        body = script[start:end].replace(
            "/var/backups/ai-platform", str(self.backups)) + "\n"
        if add_unsafe_prune:
            body = body.replace('echo "    磁盘:',
                                'docker image prune -f >/dev/null 2>&1 || true\n'
                                'echo "    磁盘:', 1)
        self.trace.write_text("")
        result = subprocess.run(
            ["bash", "-s", str(self.remote), "abcdef0", "3", "8", "5120", "100000"],
            input=body, env=self.env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("REMOTE_DONE", result.stdout)
        return self.trace.read_text().splitlines()

    def test_success_path_keeps_scoped_retention_without_global_prune(self):
        unsafe_trace = self.run_remote(add_unsafe_prune=True)
        self.assertTrue(any("docker image prune -f" in call for call in unsafe_trace),
                        "negative control must reach the old unsafe cleanup")

        trace = self.run_remote()
        self.assertFalse(any("docker image prune" in call for call in trace))
        self.assertTrue(any(call.startswith("docker rmi ai-platform-backend:") for call in trace))
        self.assertTrue(any(call.startswith("docker rmi ai-platform-frontend:") for call in trace))
        rollback = next(i for i, call in enumerate(trace)
                        if call.startswith("docker tag sha256:running ai-platform-backend:rollback-"))
        backup = next(i for i, call in enumerate(trace) if call.startswith("docker exec ai-platform-mysql"))
        switch = next(i for i, call in enumerate(trace) if "compose " in call and " up -d " in call)
        cleanup = next(i for i, call in enumerate(trace) if call.startswith("docker rmi "))
        self.assertLess(rollback, backup)
        self.assertLess(backup, switch)
        self.assertLess(switch, cleanup)


if __name__ == "__main__":
    unittest.main()
