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
LOCK = HERE / "docker-release-lock.sh"
FIRST_SITE = HERE / "deploy.sh"
DB_BACKUP = HERE.parent / "backend" / "scripts" / "db_backup.sh"
REBUILD = HERE.parent / "rebuild.sh"


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

    def sealed_root(self, commit="a" * 40, status="RELEASED", backend=None, frontend=None, manifest_commit=None, manifest_backend=None, drop_manifest=False):
        same = "sha256:" + "c" * 64
        root = self.bin / "releases"
        current = root / "current"
        current.mkdir(parents=True, exist_ok=True)
        rows = [f"SOURCE_COMMIT={commit}", f"BACKEND_IMAGE_ID={backend or same}", f"FRONTEND_IMAGE_ID={frontend or same}"]
        if status:
            rows.append(f"FINAL_STATUS={status}")
        (current / "RELEASE.txt").write_text("\n".join(rows) + "\n")
        manifest = current / "IMAGE-MANIFEST.env"
        if drop_manifest:
            manifest.unlink(missing_ok=True)
        else:
            manifest.write_text(f"SOURCE_COMMIT={manifest_commit or commit}\nBACKEND_IMAGE_ID={manifest_backend or backend or same}\nFRONTEND_IMAGE_ID={frontend or same}\n")
        return root

    def test_sealed_parent_prints_the_commit_only_when_record_manifest_and_containers_agree(self):
        same = "sha256:" + "c" * 64
        ok = self.run_check("sealed-parent", str(self.sealed_root()), RUNNING_ID=same)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(ok.stdout.strip(), f"parent={'a' * 40} backend={same} frontend={same}")
        for label, record, env, needle in (
            ("not released", {"status": None}, {}, "FINAL_STATUS"),
            ("failed release", {"status": "FAILED"}, {}, "FINAL_STATUS"),
            ("short commit", {"commit": "abcdef0"}, {}, "SOURCE_COMMIT"),
            ("manifest of another commit", {"manifest_commit": "b" * 40}, {}, "SOURCE_COMMIT"),
            ("manifest of another image", {"manifest_backend": "sha256:" + "d" * 64}, {}, "BACKEND_IMAGE_ID"),
            ("no image IDs in the record", {"backend": "none"}, {}, "BACKEND_IMAGE_ID"),
            ("no manifest", {"drop_manifest": True}, {}, "no sealed release record"),
            ("running another image", {}, {"RUNNING_ID": "sha256:" + "e" * 64}, "not the sealed release"),
            ("frontend record differs", {"frontend": "sha256:" + "f" * 64}, {}, "not the sealed release"),
            ("unhealthy", {}, {"CONTAINER_HEALTH": "unhealthy"}, "not the sealed release"),
            ("stopped", {}, {"CONTAINER_RUNNING": "false"}, "not the sealed release"),
            ("paused", {}, {"CONTAINER_PAUSED": "true"}, "not the sealed release"),
            ("restarting", {}, {"CONTAINER_RESTARTING": "true"}, "not the sealed release"),
        ):
            with self.subTest(label):
                done = self.run_check("sealed-parent", str(self.sealed_root(**record)), **({"RUNNING_ID": same} | env))
                self.assertNotEqual(done.returncode, 0, done.stdout)
                self.assertEqual(done.stdout.strip(), "", "nothing a caller could take for a parent")
                self.assertIn(needle, done.stderr)
        self.assertNotEqual(self.run_check("sealed-parent", str(self.bin / "nowhere")).returncode, 0)

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
        (self.repo / "dev" / "docker-release-lock.sh").write_bytes(LOCK.read_bytes())
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
    if [[ "$*" == *" acquire "* ]]; then echo "lock acquired"; exit 0; fi
    if [[ "$*" == *" release "* ]]; then echo "lock released"; exit 0; fi
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
        trace = self.trace.read_text()
        self.assertIn("resources", trace)
        self.assertNotIn("scp", trace)
        # the unique release lock is taken before the gate and given back when the script stops
        self.assertLess(trace.index(" acquire "), trace.index(" resources "))
        self.assertIn(" release ", trace)

    def test_unsafe_backup_retention_is_refused_before_any_connection(self):
        for value in ("0", "-1", "seven"):
            result = subprocess.run(["bash", "dev/deploy-docker.sh", "-y"], cwd=self.repo,
                                    env=self.env | {"FAKE_REMOTE_SHA": self.old_sha, "DOCKER_KEEP_DB_BACKUPS": value},
                                    text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("DOCKER_KEEP_DB_BACKUPS", result.stdout)
            self.assertFalse(self.trace.exists(), "no ssh/scp may run before the value is accepted")


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

    def run_remote(self, add_unsafe_prune=False, keep_db="7"):
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
            ["bash", "-s", str(self.remote), "abcdef0", "3", "8", "5120", "100000", keep_db],
            input=body, env=self.env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("REMOTE_DONE", result.stdout)
        self.output = result.stdout
        return self.trace.read_text().splitlines()

    def seed_backups(self):
        mysql = self.backups / "mysql"
        mysql.mkdir(parents=True, exist_ok=True)
        old = [f"ai_platform-202609{day:02d}_010000.sql.gz" for day in range(10, 19)]  # nine older dumps
        for name in old + ["ai_platform-manual-copy.sql.gz", "notes.txt"]:
            (mysql / name).write_text("x")
        return mysql, old

    def test_success_path_keeps_only_the_newest_db_backups(self):
        mysql, old = self.seed_backups()
        self.run_remote()
        dumps = sorted(p.name for p in mysql.glob("ai_platform-*_*.sql.gz") if p.name != "ai_platform-manual-copy.sql.gz")
        # this run's own backup plus the six newest seeded ones survive; the three oldest are gone
        self.assertEqual(len(dumps), 7)
        self.assertEqual(dumps[:6], old[3:])
        self.assertGreater(dumps[6], old[-1])
        for name in old[:3]:
            self.assertIn(f"删除 {name}", self.output)
        # anything not shaped like a release dump is never touched
        self.assertTrue((mysql / "ai_platform-manual-copy.sql.gz").exists())
        self.assertTrue((mysql / "notes.txt").exists())

    def test_invalid_backup_retention_on_the_server_deletes_nothing(self):
        mysql, old = self.seed_backups()
        self.run_remote(keep_db="0")
        self.assertTrue(all((mysql / name).exists() for name in old))
        self.assertIn("备份保留份数无效", self.output)

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


class FirstSiteCodeOnlyTests(unittest.TestCase):
    """dev/deploy.sh --code-only against fake ssh/scp/curl: the scope gate, the backup gate, and the prompt that stays."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo = base / "repo"
        (self.repo / "dev").mkdir(parents=True)
        (self.repo / "backend" / "scripts").mkdir(parents=True)
        (self.repo / "dev" / "deploy.sh").write_bytes(FIRST_SITE.read_bytes())
        (self.repo / "backend" / "scripts" / "db_backup.sh").write_bytes(DB_BACKUP.read_bytes())
        (self.repo / "Makefile").write_text("build:\n\t@true\n")
        run = lambda *a: subprocess.run(a, cwd=self.repo, check=True, capture_output=True)
        run("git", "init", "-q", "-b", "main")
        run("git", "config", "user.email", "test@example.invalid"); run("git", "config", "user.name", "test")
        run("git", "add", "-A"); run("git", "commit", "-qm", "base")
        self.base_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=self.repo, text=True).strip()
        bare = base / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        run("git", "remote", "add", "origin", str(bare)); run("git", "push", "-q", "origin", "main")
        self.trace = base / "trace"
        fake_bin = base / "bin"; fake_bin.mkdir()
        executable(fake_bin / "ssh", '''
echo "ssh $*" >> "$TRACE"
case "$*" in
  *"rev-parse --short HEAD"*) echo "$FAKE_REMOTE_SHORT";;
  *"APP_DIR="*) cat >/dev/null; echo /var/backups/ai-platform/mysql/ai_platform-1.sql.gz;;
  *"bash -s"*) cat > "$STAGE"; echo "remote stage";;
esac
''')
        executable(fake_bin / "scp", 'echo "scp $*" >> "$TRACE"\n')
        executable(fake_bin / "curl", 'exit 0\n')
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace), "FAKE_REMOTE_SHORT": self.base_sha, "STAGE": str(base / "stage.sh")}
        self.stage = base / "stage.sh"

    def commit(self, path):
        (self.repo / path).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / path).write_text("x\n")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", f"change {path}"], cwd=self.repo, check=True)

    def deploy(self, *args, stdin=""):
        self.trace.write_text("")
        result = subprocess.run(["bash", "dev/deploy.sh", *args], cwd=self.repo, env=self.env, input=stdin, text=True, capture_output=True)
        self.out = result.stdout + result.stderr
        self.lines = self.trace.read_text().splitlines()
        return result

    def backup_call(self):
        return next((line for line in self.lines if "APP_DIR=" in line), None)

    def test_code_only_backup_gate_adds_a_backup_without_retention(self):
        self.commit("backend/src/a.js")
        result = self.deploy("--server-first", "--code-only", "-y")
        self.assertEqual(result.returncode, 0, self.out)
        self.assertIn("BACKUP_RETENTION=skip bash -s", self.backup_call())
        self.assertIn("发布方式:    纯代码", self.out)
        self.assertIn("健康检查通过后推送 GitHub main", self.out, "the GitHub push must be on the screen the user confirms")
        self.assertTrue(any(line.endswith(" bash -s") and "APP_DIR=" not in line for line in self.lines), "the remote stage still runs")

    def test_normal_deploy_keeps_the_native_backup_gate(self):
        self.commit("backend/src/a.js")
        self.assertEqual(self.deploy("--server-first", "-y").returncode, 0, self.out)
        self.assertNotIn("BACKUP_RETENTION", self.backup_call())
        self.assertNotIn("纯代码", self.out)

    def test_code_only_refuses_database_and_startup_paths_before_the_prompt_and_backup(self):
        for path in ("backend/migrations/x.js", "backend/knexfile.js", "database/migrations/x.sql", "tools/database-upgrade/x.js",
                     "docker/scripts/run-migrations.sh", "docker-compose.yml"):
            with self.subTest(path=path):
                self.env["FAKE_REMOTE_SHORT"] = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=self.repo, text=True).strip()
                self.commit(path)
                self.assertNotEqual(self.deploy("--server-first", "--code-only", "-y").returncode, 0)
                self.assertIn(path, self.out); self.assertIn("常规发布", self.out)
                self.assertIsNone(self.backup_call()); self.assertNotIn("确认部署", self.out)

    def rebuild_env_seen(self, rebuild_text):
        """Run the tail of the remote stage in a directory holding a stub rebuild.sh; return what the stub saw, or None if it never ran."""
        text = self.stage.read_text(); tail = text[text.index("# 纯代码发布不删历史日志"):]
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "rebuild.sh").write_text(rebuild_text + '(env | grep "^REBUILD_" || true; echo "args=[$*]") > seen.txt\n')
            done = subprocess.run(["bash", "-e", "-c", tail], cwd=tmp, text=True, capture_output=True)
            seen = Path(tmp) / "seen.txt"
            return done, (seen.read_text().strip() if seen.exists() else None)

    def test_code_only_passes_the_keep_logs_switch_and_refuses_a_rebuild_that_ignores_it(self):
        self.commit("backend/src/a.js")
        self.assertEqual(self.deploy("--server-first", "--code-only", "-y").returncode, 0, self.out)
        done, seen = self.rebuild_env_seen("# knows REBUILD_KEEP_LOGS\n")
        self.assertEqual(seen, "REBUILD_KEEP_LOGS=1\nargs=[--full]", done.stderr)
        done, seen = self.rebuild_env_seen("# an old rebuild.sh\n")
        self.assertIsNone(seen, "an old rebuild.sh would delete the logs, so it must not run")
        self.assertNotEqual(done.returncode, 0); self.assertIn("不支持保留日志", done.stdout + done.stderr)

    def test_normal_deploy_does_not_pass_the_keep_logs_switch(self):
        self.commit("backend/src/a.js")
        self.assertEqual(self.deploy("--server-first", "-y").returncode, 0, self.out)
        done, seen = self.rebuild_env_seen("# an old rebuild.sh\n")
        self.assertEqual(seen, "args=[--full]", done.stderr)

    def test_code_only_sees_a_migration_moved_out_of_its_directory(self):
        self.commit("backend/migrations/20270101_x.js")
        (self.repo / "backend/migrations/20270101_x.js").write_text("exports.up = async () => {};\n" * 40)
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True); subprocess.run(["git", "commit", "-qm", "fill"], cwd=self.repo, check=True)
        self.env["FAKE_REMOTE_SHORT"] = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=self.repo, text=True).strip()
        subprocess.run(["git", "mv", "backend/migrations/20270101_x.js", "backend/x.js"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "move it"], cwd=self.repo, check=True)
        self.assertNotEqual(self.deploy("--server-first", "--code-only", "-y").returncode, 0)
        self.assertIn("backend/migrations/20270101_x.js", self.out)
        self.assertIsNone(self.backup_call())

    def test_code_only_does_not_answer_the_confirmation_prompt(self):
        self.commit("backend/src/a.js")
        for stdin in ("", "n\n"):
            with self.subTest(stdin=stdin):
                self.assertNotEqual(self.deploy("--server-first", "--code-only", stdin=stdin).returncode, 0)
                self.assertIsNone(self.backup_call(), "no backup, no transfer, no remote stage before a human says y")
                self.assertFalse(any("scp" in line for line in self.lines))
        self.assertEqual(self.deploy("--server-first", "--code-only", stdin="y\n").returncode, 0, self.out)
        self.assertIsNotNone(self.backup_call())


class RebuildLogRetentionTests(unittest.TestCase):
    """The real rebuild.sh --restart with fake pm2/curl: which history logs survive."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.project = base / "project"; self.home = base / "home"; self.trace = base / "trace"
        fake_bin = base / "bin"; fake_bin.mkdir(); self.project.mkdir(); self.home.mkdir()
        executable(fake_bin / "pm2", 'echo "pm2 $*" >> "$TRACE"\n')
        executable(fake_bin / "curl", 'case "$*" in *http_code*) printf 200;; *) echo "{}";; esac\n')
        executable(fake_bin / "sleep", 'exit 0\n')
        (self.project / "backend").mkdir(); (self.project / "backend" / ".env").write_text("DB_PASSWORD=not-a-real-one\n")
        self.script = base / "rebuild.sh"
        self.script.write_text(REBUILD.read_text().replace("/var/www/ai-platform", str(self.project)))
        self.logs = [self.home / ".pm2" / "logs" / "ai-platform-auth-out.log", self.project / "logs" / "backend" / "auth" / "combined.log",
                     self.project / "logs" / "backend" / "auth" / "error.log", self.project / "logs" / "frontend" / "out.log"]
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace), "HOME": str(self.home)}
        self.env.pop("REBUILD_KEEP_LOGS", None)

    def restart(self, **extra):
        for log in self.logs:
            log.parent.mkdir(parents=True, exist_ok=True); log.write_text("history\n")
        self.trace.write_text("")
        done = subprocess.run(["bash", str(self.script), "--restart"], env=self.env | extra, text=True, capture_output=True, stdin=subprocess.DEVNULL, timeout=120)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return self.trace.read_text()

    def test_keep_logs_leaves_every_history_log_and_still_restarts(self):
        calls = self.restart(REBUILD_KEEP_LOGS="1")
        for log in self.logs:
            self.assertEqual(log.read_text(), "history\n", log)
        self.assertNotIn("pm2 flush", calls)
        self.assertIn("pm2 delete all", calls); self.assertIn("pm2 start", calls)

    def test_without_the_switch_the_native_cleanup_is_unchanged(self):
        for extra in ({}, {"REBUILD_KEEP_LOGS": "yes"}, {"REBUILD_KEEP_LOGS": "0"}):
            with self.subTest(extra=extra):
                calls = self.restart(**extra)
                for log in self.logs:
                    self.assertFalse(log.exists(), log)
                self.assertIn("pm2 flush", calls); self.assertIn("pm2 start", calls)


class DbBackupRetentionTests(unittest.TestCase):
    """backend/scripts/db_backup.sh with a fake mysqldump: the keep rule, and the explicit no-retention switch."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.app = base / "app"; (self.app / "backend").mkdir(parents=True)
        (self.app / "backend" / ".env").write_text("DB_NAME=ai_platform\nDB_USER=u\nDB_PASSWORD=p\n")
        self.dir = base / "backups"; self.dir.mkdir()
        fake_bin = base / "bin"; fake_bin.mkdir()
        executable(fake_bin / "mysqldump", 'echo "CREATE TABLE t (id INT);"\n')
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "APP_DIR": str(self.app), "BACKUP_DIR": str(self.dir)}
        self.old = []
        for n in range(14):
            dump = self.dir / f"ai_platform-202610{n + 10:02d}_033000.sql.gz"
            dump.write_text("old"); (self.dir / (dump.name + ".sha256")).write_text("x")
            os.utime(dump, (1_700_000_000 + n, 1_700_000_000 + n))
            self.old.append(dump)

    def run_backup(self, **extra):
        done = subprocess.run(["bash", str(DB_BACKUP)], env=self.env | extra, text=True, capture_output=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len(done.stdout.strip().splitlines()), 1, "stdout stays exactly the new path")
        return Path(done.stdout.strip())

    def test_default_keeps_the_newest_fourteen_and_removes_the_oldest_pair(self):
        new = self.run_backup()
        self.assertTrue(new.exists())
        self.assertEqual(len(list(self.dir.glob("*.sql.gz"))), 14)
        self.assertFalse(self.old[0].exists()); self.assertFalse(Path(str(self.old[0]) + ".sha256").exists())

    def test_explicit_skip_adds_the_backup_and_removes_nothing(self):
        new = self.run_backup(BACKUP_RETENTION="skip")
        self.assertTrue(new.exists()); self.assertTrue(Path(str(new) + ".sha256").exists())
        self.assertEqual(len(list(self.dir.glob("*.sql.gz"))), 15)
        self.assertTrue(all(dump.exists() for dump in self.old))

    def test_any_other_value_is_not_a_way_to_skip(self):
        self.run_backup(BACKUP_RETENTION="yes")
        self.assertEqual(len(list(self.dir.glob("*.sql.gz"))), 14)


class RealResourceProbe(unittest.TestCase):
    """假命令测不到的那一格：资源预检要在真机上真的跑得通。

    这次发布就是栽在这里——`df -i --output=iavail` 被 coreutils 判为互斥选项，预检直接 exit 1，
    整条 Docker 发布在动任何东西之前就停了。假命令夹具永远不会真的调用 df，
    所以这条用例故意不打桩，直接在本机跑一次真实的资源分支。
    """

    def test_resources_branch_runs_on_this_machine(self):
        script = Path(__file__).resolve().parent / "docker-release-preflight.sh"
        done = subprocess.run(["bash", str(script), "resources", "1", "1", "1"],
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("resources ready:", done.stdout)
        for field in ("disk=", "memory=", "inodes="):
            self.assertIn(field, done.stdout)
        self.assertNotIn("unreadable", done.stderr)


if __name__ == "__main__":
    unittest.main()
