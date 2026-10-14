#!/usr/bin/env python3
"""Guards for the prebuilt-image release path (make build-images → make deploy-docker --prebuilt).

Fake ssh/scp/docker everywhere except RealImageRoundTrip, which uses the local Docker daemon only.
Never contacts production or any remote host."""
import gzip
import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEPLOY = HERE / "deploy-docker.sh"
PREFLIGHT = HERE / "docker-release-preflight.sh"
LOCK = HERE / "docker-release-lock.sh"
BUILD = HERE / "build-images.sh"
ID_B = "sha256:" + "b" * 64
ID_F = "sha256:" + "f" * 64


def executable(path, body):
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(0o755)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_package(pkg, commit, task="v-abcdef0-20261014_120000", domain="ai.pkuailab.com",
                  platform="linux/amd64", corrupt=False, drop_key=None, id_b=ID_B, id_f=ID_F):
    pkg = Path(pkg)
    pkg.mkdir(parents=True, exist_ok=True)
    tar = pkg / "images.tar.gz"
    tar.write_bytes(gzip.compress(b"fake docker save stream " * 2000))
    rows = {
        "SCHEMA": "ai-platform-image-package/1", "TASK": task, "SOURCE_COMMIT": commit,
        "TAR_SHA256": ("0" * 64) if corrupt else sha256(tar), "TAR_SIZE": str(tar.stat().st_size),
        "BACKEND_IMAGE_TAG": f"ai-platform-backend:{task}", "BACKEND_IMAGE_ID": id_b, "BACKEND_IMAGE_SIZE": "300000000",
        "FRONTEND_IMAGE_TAG": f"ai-platform-frontend:{task}", "FRONTEND_IMAGE_ID": id_f, "FRONTEND_IMAGE_SIZE": "100000000",
        "IMAGE_PLATFORM": platform, "CUSTOMER_DOMAIN_BUILD_ARG": domain,
    }
    if drop_key:
        rows.pop(drop_key)
    (pkg / "MANIFEST.env").write_text("".join(f"{k}={v}\n" for k, v in rows.items()))
    return pkg


def git_repo_with_origin(base):
    """A clean main checkout whose HEAD is pushed to a bare origin; returns (repo, old_sha, new_sha)."""
    repo = base / "repo"
    (repo / "dev").mkdir(parents=True)
    for src in (DEPLOY, PREFLIGHT, LOCK, BUILD):
        (repo / "dev" / src.name).write_bytes(src.read_bytes())
    (repo / "docker").mkdir()
    (repo / "docker" / "Dockerfile.backend").write_text("FROM scratch\n")
    (repo / "docker" / "Dockerfile.frontend").write_text("FROM scratch\nARG CUSTOMER_DOMAIN\n")
    (repo / "backend").mkdir(); (repo / "frontend").mkdir()
    (repo / "backend" / "package-lock.json").write_text("{}\n")
    (repo / "frontend" / "package-lock.json").write_text("{}\n")
    (repo / "docker-compose.yml").write_text("services: {}\n")
    (repo / ".dockerignore").write_text("node_modules/\n")
    run = lambda *a: subprocess.run(a, cwd=repo, check=True, capture_output=True)
    run("git", "init", "-q", "-b", "main")
    run("git", "config", "user.email", "test@example.invalid"); run("git", "config", "user.name", "test")
    run("git", "add", "-A"); run("git", "commit", "-qm", "base")
    old = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    (repo / "change.txt").write_text("next\n"); run("git", "add", "change.txt"); run("git", "commit", "-qm", "next")
    new = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    bare = base / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
    run("git", "remote", "add", "origin", str(bare)); run("git", "push", "-q", "origin", "main")
    return repo, old, new


class PreflightProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.bin = Path(self.temp.name) / "bin"; self.bin.mkdir()
        executable(self.bin / "docker", '''
if [ "${FAKE_MISSING:-0}" = 1 ]; then echo "No such image" >&2; exit 1; fi
case "$*" in
  *"{{.Server.Os}}"*) echo "${FAKE_OS:-linux}";;
  *"{{.Server.Arch}}"*) echo "${FAKE_ARCH-x86_64}";;
  *"{{.Id}}"*) echo "${TAGGED_ID:-sha256:abc}";;
  *"{{.Os}}"*) echo linux;;
  *"{{.Architecture}}"*) echo "${FAKE_IMAGE_ARCH:-amd64}";;
  *"{{.Size}}"*) echo 4242;;
  *"range .Config.Env"*) printf 'PATH=/usr/bin\\nCUSTOMER_DOMAIN=%s\\n' "${FAKE_DOMAIN:-example.test}";;
esac
''')
        executable(self.bin / "df", '''
case "$*" in
  *"--output=avail"*) printf 'Avail\\n%s\\n' "${FAKE_DISK:-99999999999}";;
  *"--output=iavail"*) printf 'IAvail\\n%s\\n' "${FAKE_INODES:-9999999}";;
esac
''')
        executable(self.bin / "free", 'printf "              total        used        free      shared  buff/cache   available\\nMem: 1 1 1 1 1 %s\\n" "${FAKE_MEMORY:-99999999999}"\n')
        self.env = os.environ | {"PATH": str(self.bin) + os.pathsep + os.environ["PATH"]}

    def run_pf(self, *args, **extra):
        return subprocess.run(["bash", str(PREFLIGHT), *args], env=self.env | {k: str(v) for k, v in extra.items()},
                              text=True, capture_output=True)

    def test_arch_is_normalized_and_fails_closed(self):
        self.assertEqual(self.run_pf("arch").stdout.strip(), "linux/amd64")
        self.assertEqual(self.run_pf("arch", FAKE_ARCH="aarch64").stdout.strip(), "linux/arm64")
        self.assertNotEqual(self.run_pf("arch", FAKE_ARCH="").returncode, 0)

    def test_image_identity_reports_id_platform_size_and_domain(self):
        done = self.run_pf("image-identity", "ai-platform-frontend:v-abc1234-20261014_000000", TAGGED_ID=ID_F, FAKE_DOMAIN="ai.pkuailab.com")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.strip(), f"id={ID_F} platform=linux/amd64 size=4242 customer_domain=ai.pkuailab.com")
        self.assertNotEqual(self.run_pf("image-identity", "ai-platform-frontend:v-x", FAKE_MISSING=1).returncode, 0)
        self.assertEqual(self.run_pf("image-identity", "bad tag;rm").returncode, 2)

    def test_resources_label_only_changes_the_message(self):
        ok = self.run_pf("resources", "1", "1", "1", "prebuilt")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        low = self.run_pf("resources", "1", "1", "1", "prebuilt", FAKE_MEMORY=str(1024 ** 2 - 1))
        self.assertNotEqual(low.returncode, 0)
        self.assertIn("insufficient prebuilt resources", low.stderr)
        self.assertIn("insufficient build resources", self.run_pf("resources", "1", "1", "1", FAKE_MEMORY="1").stderr)

    def test_untracked_context_lists_files_an_onsite_build_would_copy(self):
        repo = Path(self.temp.name) / "checkout"
        (repo / "frontend" / "src").mkdir(parents=True)
        (repo / "frontend" / "src" / "a.js").write_text("a")
        run = lambda *a: subprocess.run(a, cwd=repo, check=True, capture_output=True)
        run("git", "init", "-q"); run("git", "config", "user.email", "t@e.invalid"); run("git", "config", "user.name", "t")
        run("git", "add", "-A"); run("git", "commit", "-qm", "base")
        clean = subprocess.run(["bash", str(PREFLIGHT), "untracked-context", str(repo)], text=True, capture_output=True)
        self.assertEqual(clean.returncode, 0, clean.stderr)
        for ignored in ("frontend/dist/x.js", "backend/logs/a.log", "frontend/node_modules/m/i.js", "backend/.env", "frontend/run.sh"):
            (repo / ignored).parent.mkdir(parents=True, exist_ok=True); (repo / ignored).write_text("x")
        self.assertEqual(subprocess.run(["bash", str(PREFLIGHT), "untracked-context", str(repo)], text=True, capture_output=True).returncode, 0,
                         "files .dockerignore excludes must not count")
        (repo / "frontend" / "public" / "www").mkdir(parents=True)
        (repo / "frontend" / "public" / "www" / "index.html").write_text("portal")
        found = subprocess.run(["bash", str(PREFLIGHT), "untracked-context", str(repo)], text=True, capture_output=True)
        self.assertEqual(found.returncode, 1)
        self.assertIn("frontend/public/www/index.html", found.stdout)
        self.assertNotIn("frontend/dist/x.js", found.stdout)


class LockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.lock = str(Path(self.temp.name) / "releases" / ".lock")

    def run_lock(self, *args):
        return subprocess.run(["bash", str(LOCK), *args], text=True, capture_output=True)

    def test_acquire_is_exclusive_and_release_is_owner_only(self):
        self.assertEqual(self.run_lock("acquire", self.lock, "deploy-1-aaaaaaaa").returncode, 0)
        self.assertIn("held:", self.run_lock("status", self.lock).stdout)
        second = self.run_lock("acquire", self.lock, "deploy-2-bbbbbbbb")
        self.assertEqual(second.returncode, 3); self.assertIn("deploy-1-aaaaaaaa", second.stderr)
        self.assertEqual(self.run_lock("release", self.lock, "deploy-2-bbbbbbbb").returncode, 3, "another release's lock must stay")
        self.assertTrue(Path(self.lock).is_dir())
        self.assertEqual(self.run_lock("release", self.lock, "deploy-1-aaaaaaaa").returncode, 0)
        self.assertEqual(self.run_lock("status", self.lock).stdout.strip(), "free")
        self.assertEqual(self.run_lock("release", self.lock, "deploy-1-aaaaaaaa").returncode, 0, "releasing a free lock is a no-op")
        self.assertEqual(self.run_lock("acquire", self.lock, "bad token").returncode, 2)


class PrebuiltLocalRefusalTests(unittest.TestCase):
    """Package problems are refused before any ssh/scp runs."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo, self.old, self.new = git_repo_with_origin(base)
        self.trace = base / "trace"
        fake_bin = base / "bin"; fake_bin.mkdir()
        executable(fake_bin / "ssh", 'echo "ssh $*" >> "$TRACE"; exit 99\n')
        executable(fake_bin / "scp", 'echo "scp $*" >> "$TRACE"; exit 99\n')
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace),
                                 "PM2_SSH_HOST": "fake-pm2", "DOCKER_SSH_HOST": "fake-docker"}
        self.pkg = base / "pkg"

    def deploy(self, pkg):
        return subprocess.run(["bash", "dev/deploy-docker.sh", "-y", f"--prebuilt={pkg}"], cwd=self.repo, env=self.env, text=True, capture_output=True)

    def assert_refused_offline(self, result, needle):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(needle, result.stdout + result.stderr)
        self.assertFalse(self.trace.exists(), "no ssh/scp may run before the package is accepted")

    def test_wrong_commit_is_refused(self):
        self.assert_refused_offline(self.deploy(write_package(self.pkg, self.old)), "错提交")

    def test_corrupt_tar_is_refused(self):
        self.assert_refused_offline(self.deploy(write_package(self.pkg, self.new, corrupt=True)), "摘要")

    def test_other_sites_domain_is_refused(self):
        self.assert_refused_offline(self.deploy(write_package(self.pkg, self.new, domain="ai.xingyuncl.com")), "CUSTOMER_DOMAIN")

    def test_incomplete_manifest_is_refused(self):
        self.assert_refused_offline(self.deploy(write_package(self.pkg, self.new, drop_key="TAR_SHA256")), "TAR_SHA256")
        self.assert_refused_offline(self.deploy(write_package(self.pkg, self.new, platform="linux/riscv64")), "IMAGE_PLATFORM")

    def test_missing_package_files_are_refused(self):
        self.assert_refused_offline(self.deploy(self.repo / "nowhere"), "不存在")


class PrebuiltOrderTests(unittest.TestCase):
    """The order of remote operations in prebuilt mode, against a fake ssh that answers each probe."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo, self.old, self.new = git_repo_with_origin(base)
        self.trace = base / "trace"
        fake_bin = base / "bin"; fake_bin.mkdir()
        executable(fake_bin / "ssh", '''
echo "ssh $*" >> "$TRACE"
case "$*" in
  *"git status --porcelain"*) echo 0;;
  *"git rev-parse HEAD"*) if [[ "$*" == *"fake-pm2"* ]]; then echo "$FAKE_LOCAL_SHA"; else echo "$FAKE_REMOTE_SHA"; fi;;
  *"sha256sum -c --status && mv"*) [ "${FAKE_PART_OK:-1}" = 1 ] && exit 0 || exit 1;;
  *"sha256sum -c --status"*) [ "${FAKE_REMOTE_PKG_PRESENT:-0}" = 1 ] && exit 0 || exit 1;;
  *"mkdir -p"*) exit 0;;
  *"rm -f"*) exit 0;;
  *"git fetch"*) echo "    服务器现在位于: abc"; exit 0;;
  *"bash -s"*) cat >/dev/null
    if [[ "$*" == *" runtime "* ]]; then echo "${FAKE_RUNTIME:-STALE backend image=old}"; exit 0; fi
    if [[ "$*" == *" arch" ]]; then echo "${FAKE_REMOTE_PLATFORM-linux/amd64}"; exit 0; fi
    if [[ "$*" == *" untracked-context "* ]]; then if [ -n "${FAKE_UNTRACKED:-}" ]; then echo "$FAKE_UNTRACKED"; exit 1; fi; echo "no untracked build-context files"; exit 0; fi
    if [[ "$*" == *" acquire "* ]]; then if [ "${FAKE_LOCK_HELD:-0}" = 1 ]; then echo "release lock held: token=other" >&2; exit 3; fi; echo "lock acquired"; exit 0; fi
    if [[ "$*" == *" release "* ]]; then echo "lock released"; exit 0; fi
    if [[ "$*" == *" resources "* ]]; then if [ "${FAKE_RESOURCES:-ok}" = ok ]; then echo "resources ready: disk=1 bytes memory=1 bytes inodes=1"; exit 0; fi; echo "insufficient ${FAKE_RESOURCES} resources" >&2; exit 1; fi
    echo "REMOTE_MAIN"; exit 99;;
esac
''')
        executable(fake_bin / "scp", 'echo "scp $*" >> "$TRACE"; exit 0\n')
        executable(fake_bin / "curl", 'exit 0\n')
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace),
                                 "PM2_SSH_HOST": "fake-pm2", "DOCKER_SSH_HOST": "fake-docker", "FAKE_LOCAL_SHA": self.new}
        self.pkg = write_package(base / "pkg", self.new)

    def deploy(self, remote_sha=None, **knobs):
        env = self.env | {"FAKE_REMOTE_SHA": remote_sha or self.old} | {k: str(v) for k, v in knobs.items()}
        self.trace.write_text("")
        result = subprocess.run(["bash", "dev/deploy-docker.sh", "-y", f"--prebuilt={self.pkg}"], cwd=self.repo, env=env, text=True, capture_output=True)
        self.out = result.stdout + result.stderr
        self.lines = self.trace.read_text().splitlines() if self.trace.exists() else []
        return result

    def first(self, needle):
        for i, line in enumerate(self.lines):
            if needle in line:
                return i
        return None

    def test_arch_mismatch_refuses_before_lock_and_transfer(self):
        self.assertNotEqual(self.deploy(FAKE_REMOTE_PLATFORM="linux/arm64").returncode, 0)
        self.assertIn("错架构", self.out)
        self.assertIsNotNone(self.first(" arch")); self.assertIsNone(self.first(" acquire ")); self.assertIsNone(self.first("scp "))
        self.assertNotEqual(self.deploy(FAKE_REMOTE_PLATFORM="").returncode, 0, "unknown platform must refuse too")

    def test_untracked_build_context_refuses_before_lock_and_transfer(self):
        self.assertNotEqual(self.deploy(FAKE_UNTRACKED="frontend/public/www/index.html").returncode, 0)
        self.assertIn("frontend/public/www/index.html", self.out)
        self.assertIsNone(self.first(" acquire ")); self.assertIsNone(self.first("scp "))

    def test_held_lock_refuses_before_gate_and_transfer(self):
        self.assertNotEqual(self.deploy(FAKE_LOCK_HELD=1).returncode, 0)
        self.assertIn("发布锁", self.out)
        self.assertIsNotNone(self.first(" acquire ")); self.assertIsNone(self.first(" resources ")); self.assertIsNone(self.first("scp "))
        self.assertIsNone(self.first(" release "), "a lock we never got must not be released")

    def test_prebuilt_gate_uses_split_thresholds_and_stops_before_transfer(self):
        self.assertNotEqual(self.deploy(FAKE_RESOURCES="prebuilt").returncode, 0)
        gate = self.first(" resources ")
        self.assertIsNotNone(gate)
        # tar (~0.05 MiB) + 300 MB + 100 MB + 2 GiB margin → 3 GiB; memory only needs the runtime headroom
        self.assertIn(" resources 3 1024 100000 prebuilt", self.lines[gate])
        self.assertIsNone(self.first("scp "))
        self.assertIsNotNone(self.first(" release "), "the lock is given back when the gate refuses")
        self.assertNotEqual(self.deploy(FAKE_RESOURCES="prebuilt", DOCKER_PREBUILT_MIN_AVAILABLE_MIB="2048").returncode, 0)
        self.assertIn(" resources 3 2048 100000 prebuilt", self.lines[self.first(" resources ")])

    def test_transfer_goes_to_temp_name_and_is_verified_before_rename(self):
        self.assertNotEqual(self.deploy().returncode, 0, "fake remote main stage stops with 99")
        order = [self.first(" acquire "), self.first(" resources "), self.first("scp -q -o BatchMode=yes /tmp/ai-platform-"),
                 self.first("images.tar.gz.part"), self.first("sha256sum -c --status && mv"), self.first("MANIFEST.env"), self.first("bash -s /var/www/ai-platform")]
        self.assertTrue(all(i is not None for i in order), (order, self.lines))
        self.assertEqual(order, sorted(order), "lock → gate → code bundle → package .part → remote verify+rename → manifest → remote stage")
        main = self.lines[order[-1]]
        self.assertIn(" prebuilt ", main); self.assertIn("/var/tmp/ai-platform-images/v-abcdef0-20261014_120000", main)
        self.assertIn(ID_B, main); self.assertIn(ID_F, main); self.assertIn("linux/amd64", main)

    def test_corrupt_remote_copy_is_deleted_and_nothing_loads(self):
        self.assertNotEqual(self.deploy(FAKE_PART_OK=0).returncode, 0)
        self.assertIn("摘要不符", self.out)
        self.assertIsNotNone(self.first("rm -f '/var/tmp/ai-platform-images/v-abcdef0-20261014_120000/images.tar.gz.part'"))
        self.assertIsNone(self.first("bash -s /var/www/ai-platform"))
        self.assertIsNotNone(self.first(" release "))

    def test_verified_remote_package_is_reused_not_resent(self):
        self.deploy(FAKE_REMOTE_PKG_PRESENT=1)
        self.assertIn("复用", self.out)
        self.assertIsNone(self.first("images.tar.gz.part"))
        self.assertIsNotNone(self.first("bash -s /var/www/ai-platform"))

    def test_same_version_healthy_exits_zero_without_touching_the_lock(self):
        self.assertEqual(self.deploy(remote_sha=self.new, FAKE_RUNTIME="CURRENT").returncode, 0, self.out)
        self.assertIsNone(self.first(" acquire ")); self.assertIsNone(self.first("scp "))


class PrebuiltRemoteStageTests(unittest.TestCase):
    """The server-side stage in prebuilt mode: load → verify → (backup → migrate → switch), never build."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.remote = base / "remote"; (self.remote / "dev").mkdir(parents=True)
        (self.remote / "dev" / "docker-release-lock.sh").write_bytes(LOCK.read_bytes())
        executable(self.remote / "dev" / "docker-release-preflight.sh", '''
case "$1" in
  runtime) echo CURRENT;;
  resources) echo "resources ready: disk=1 bytes memory=1 bytes inodes=1";;
  arch) echo "${FAKE_HOST_PLATFORM:-linux/amd64}";;
  image-identity)
    case "$2" in
      ai-platform-backend:*) echo "id=${FAKE_ID_BACKEND} platform=linux/amd64 size=1 customer_domain=-";;
      *) echo "id=${FAKE_ID_FRONTEND} platform=linux/amd64 size=1 customer_domain=${FAKE_IMG_DOMAIN:-ai.pkuailab.com}";;
    esac;;
esac
''')
        (self.remote / ".env").write_text('CUSTOMER_DOMAIN="ai.pkuailab.com"\nDB_PASSWORD=secret\n')
        self.bin = base / "bin"; self.bin.mkdir()
        self.trace = base / "docker-trace"
        executable(self.bin / "docker", '''
echo "docker $*" >> "$TRACE"
if [[ "$1" == load ]]; then [ "${FAKE_LOAD_FAIL:-0}" = 1 ] && { echo "invalid tar header" >&2; exit 1; }; echo "Loaded image: x"; exit 0; fi
if [[ "$1" == image && "$2" == inspect ]]; then echo sha256:old; exit 0; fi
if [[ "$1" == inspect ]]; then
  if [[ "$*" == *"{{.Config.Image}}"* ]]; then case "$*" in *backend*) echo ai-platform-backend:v-old;; *) echo ai-platform-frontend:v-old;; esac
  elif [[ "$*" == *"{{.Image}}"* ]]; then echo sha256:running; fi
  exit 0
fi
if [[ "$1" == exec ]]; then echo 'CREATE TABLE fake_backup (id INT);'; exit 0; fi
if [[ "$1" == images ]]; then exit 0; fi
if [[ "$1" == ps ]]; then echo 'ai-platform-backend running'; exit 0; fi
if [[ "$1" == compose && " $* " == *" run "* ]]; then echo 'Already up to date'; exit 0; fi
exit 0
''')
        executable(self.bin / "git", 'if [[ "$*" == "rev-parse HEAD" ]]; then echo abcdef0123456789; fi\n')
        self.backups = base / "backups"
        self.pkg = base / "pkg"; self.pkg.mkdir()
        (self.pkg / "images.tar.gz").write_bytes(gzip.compress(b"fake"))
        (self.pkg / "MANIFEST.env").write_text("TASK=v-abcdef0-20261014_120000\n")
        self.sha = sha256(self.pkg / "images.tar.gz")
        self.task = "v-abcdef0-20261014_120000"
        self.lock = self.backups / "releases" / ".lock"
        self.env = os.environ | {"PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace),
                                 "FAKE_ID_BACKEND": ID_B, "FAKE_ID_FRONTEND": ID_F}

    def remote_body(self):
        script = DEPLOY.read_text()
        marker = '<<\'REMOTE\' | tee "$REMOTE_LOG"\n'
        start = script.index(marker) + len(marker)
        end = script.index("\nREMOTE\n", start)
        return script[start:end].replace("/var/backups/ai-platform", str(self.backups)) + "\n"

    def run_remote(self, sha=None, id_b=ID_B, id_f=ID_F, **knobs):
        token = "deploy-20261014-1-abcdef0"
        subprocess.run(["bash", str(LOCK), "acquire", str(self.lock), token], check=True, capture_output=True)
        self.trace.write_text("")
        args = [str(self.remote), "abcdef0", "3", "3", "1024", "100000", "7", "prebuilt", str(self.lock), token,
                str(self.pkg), self.task, sha or self.sha, id_b, id_f, "linux/amd64"]
        result = subprocess.run(["bash", "-s", *args], input=self.remote_body(), env=self.env | {k: str(v) for k, v in knobs.items()},
                                text=True, capture_output=True)
        self.output = result.stdout + result.stderr
        self.lines = self.trace.read_text().splitlines()
        return result

    def first(self, needle):
        for i, line in enumerate(self.lines):
            if needle in line:
                return i
        return None

    def test_success_loads_verifies_then_releases_and_never_builds(self):
        result = self.run_remote()
        self.assertEqual(result.returncode, 0, self.output)
        self.assertIn("REMOTE_DONE", result.stdout)
        order = [self.first(f"load -i {self.pkg}/images.tar.gz"), self.first("exec ai-platform-mysql"), self.first("run --rm --no-deps -T backend npx knex migrate:latest"), self.first("up -d backend frontend")]
        self.assertTrue(all(i is not None for i in order), self.lines)
        self.assertEqual(order, sorted(order), "load → backup → migrate → switch")
        self.assertIsNone(self.first("compose build"), "the prebuilt path never builds on the server")
        rel = self.backups / "releases" / f"ai-platform-{self.task}"
        text = (rel / "RELEASE.txt").read_text()
        for line in ("IMAGES_SOURCE=prebuilt", f"IMAGE_PACKAGE_SHA256={self.sha}", f"BACKEND_IMAGE_ID={ID_B}", "IMAGES_LOADED=1", "CONTAINERS_SWITCHED=1", "FINAL_STATUS=RELEASED"):
            self.assertIn(line, text)
        self.assertLess(text.index("IMAGES_LOADED=1"), text.index("CONTAINERS_SWITCHED=1"))
        self.assertTrue((rel / "IMAGE-MANIFEST.env").exists())
        self.assertEqual(os.readlink(self.backups / "releases" / "current"), str(rel))
        self.assertFalse(self.pkg.exists(), "the package is removed only after a successful switch")
        self.assertFalse(self.lock.exists(), "the lock is released on exit")

    def test_identity_mismatch_removes_loaded_tags_and_switches_nothing(self):
        result = self.run_remote(id_f="sha256:" + "e" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("核验失败", self.output)
        self.assertIsNotNone(self.first(f"rmi ai-platform-backend:{self.task} ai-platform-frontend:{self.task}"))
        for forbidden in ("exec ai-platform-mysql", "migrate:latest", "up -d", "compose build", "tag sha256:running"):
            self.assertIsNone(self.first(forbidden), forbidden)
        rel = self.backups / "releases" / f"ai-platform-{self.task}"
        self.assertFalse((rel / "RELEASE.txt").exists(), "no release record before verification passes")
        self.assertFalse((self.backups / "releases" / "current").exists(), "current is not moved")
        self.assertTrue(self.pkg.exists(), "the package stays for diagnosis")
        self.assertFalse(self.lock.exists())

    def test_domain_platform_or_checksum_mismatch_refuses_before_any_switch(self):
        self.assertNotEqual(self.run_remote(FAKE_IMG_DOMAIN="ai.xingyuncl.com").returncode, 0)
        self.assertIn("CUSTOMER_DOMAIN", self.output); self.assertIsNone(self.first("up -d"))
        self.assertNotEqual(self.run_remote(FAKE_HOST_PLATFORM="linux/arm64").returncode, 0)
        self.assertIn("平台", self.output); self.assertIsNone(self.first("up -d"))
        self.assertNotEqual(self.run_remote(sha="0" * 64).returncode, 0)
        self.assertIsNone(self.first("load -i"), "a package whose checksum does not match is never loaded")
        self.assertNotEqual(self.run_remote(FAKE_LOAD_FAIL=1).returncode, 0)
        self.assertIsNone(self.first("exec ai-platform-mysql")); self.assertIsNone(self.first("up -d"))
        self.assertFalse(self.lock.exists())


class BuildImagesTests(unittest.TestCase):
    """build-images.sh against fake ssh/scp: probes, refusals, the build snippet, fetch verification, cleanup."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo, self.old, self.new = git_repo_with_origin(base)
        self.trace = base / "trace"; self.capture = base / "remote-build-stdin"
        self.remote_fs = base / "remote-fs"; self.remote_fs.mkdir()
        self.pkg_root = base / "packages"
        fake_bin = base / "bin"; fake_bin.mkdir()
        executable(fake_bin / "ssh", '''
echo "ssh $*" >> "$TRACE"
case "$*" in
  *"bash -s -- arch"*) cat >/dev/null; echo "${FAKE_TARGET_PLATFORM-linux/amd64}";;
  *"bash -s -- resources"*) cat >/dev/null; if [ "${FAKE_BUILD_RESOURCES:-ok}" = ok ]; then echo "resources ready: disk=1 bytes memory=1 bytes inodes=1"; else echo "insufficient image-build resources" >&2; exit 1; fi;;
  *"bash -s -- /var/tmp/ai-platform-image-build"*) cat >/dev/null
    printf 'docker=%s\\ndocker_server=27.0\\nplatform=%s\\nuname_m=x86_64\\nkernel=6.1\\nbuildx=absent\\nstorage_driver=overlay2\\ndocker_root=/var/lib/docker\\nncpu=4\\nmem_total_bytes=16000000000\\nmem_available_bytes=%s\\nswap_total_bytes=0\\ndisk_root_avail_bytes=50000000000\\ndisk_docker_root_avail_bytes=50000000000\\ndisk_build_dir_avail_bytes=50000000000\\ninodes_root_avail=3000000\\nbase_node=absent\\nbase_nginx=absent\\nbuild_dir_exists=no\\ntask_dirs_present=0\\n' "${FAKE_BUILD_DOCKER:-ok}" "${FAKE_BUILD_PLATFORM:-linux/amd64}" "${FAKE_BUILD_MEM:-8000000000}";;
  *"mkdir -p"*) exit 0;;
  *"tar -x -C"*) cat >/dev/null; exit 0;;
  *"bash -s /var/tmp/ai-platform-image-build"*) cat > "$CAPTURE"; if [ "${FAKE_REMOTE_BUILD:-stop}" = done ]; then echo "REMOTE_BUILD_DONE"; exit 0; fi; echo "❌ fake build stop"; exit 99;;
  *"docker rmi"*) exit 0;;
  *) exit 99;;
esac
''')
        executable(fake_bin / "scp", '''
echo "scp $*" >> "$TRACE"
src="${@: -2:1}"; dst="${@: -1}"
cp "$FAKE_REMOTE_FS/$(basename "${src#*:}")" "$dst"
''')
        self.env = os.environ | {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "TRACE": str(self.trace), "CAPTURE": str(self.capture),
                                 "FAKE_REMOTE_FS": str(self.remote_fs), "IMAGE_BUILD_SSH_HOST": "fake-build", "DOCKER_SSH_HOST": "fake-docker",
                                 "IMAGE_PACKAGE_ROOT": str(self.pkg_root)}

    def build(self, *args, **knobs):
        self.trace.write_text("")
        if self.capture.exists():
            self.capture.unlink()
        result = subprocess.run(["bash", "dev/build-images.sh", "-y", *args], cwd=self.repo, env=self.env | {k: str(v) for k, v in knobs.items()}, text=True, capture_output=True)
        self.out = result.stdout + result.stderr
        self.lines = self.trace.read_text().splitlines() if self.trace.exists() else []
        return result

    def first(self, needle):
        for i, line in enumerate(self.lines):
            if needle in line:
                return i
        return None

    def stage_remote_package(self, sha=None, platform="linux/amd64"):
        tar = self.remote_fs / "images.tar.gz"
        tar.write_bytes(gzip.compress(b"fake save " * 500))
        rows = {"TASK": "v-x", "BUILDER": "legacy", "IMAGE_PLATFORM": platform, "BACKEND_IMAGE_ID": ID_B, "FRONTEND_IMAGE_ID": ID_F,
                "TAR_SHA256": sha or sha256(tar), "TAR_SIZE": str(tar.stat().st_size)}
        (self.remote_fs / "MANIFEST.remote.env").write_text("".join(f"{k}={v}\n" for k, v in rows.items()))

    def test_precheck_only_probes_and_writes_nothing_remote(self):
        result = self.build("--precheck")
        self.assertEqual(result.returncode, 0, self.out)
        self.assertIsNotNone(self.first("bash -s -- arch")); self.assertIsNotNone(self.first("bash -s -- /var/tmp/ai-platform-image-build"))
        for forbidden in ("mkdir -p", "tar -x", "bash -s /var/tmp", "resources"):
            self.assertIsNone(self.first(forbidden), forbidden)
        self.assertTrue(list(self.pkg_root.glob("precheck-fake-build-*.env")), "a local precheck record is written")

    def test_unknown_target_or_missing_docker_or_arch_mismatch_refuse_before_any_remote_write(self):
        self.assertNotEqual(self.build(FAKE_TARGET_PLATFORM="unknown").returncode, 0); self.assertIn("架构未知", self.out)
        self.assertIsNone(self.first("bash -s -- /var/tmp"), "the build host is not even probed without a known target")
        self.assertNotEqual(self.build(FAKE_BUILD_DOCKER="missing").returncode, 0); self.assertIn("不安装", self.out)
        self.assertNotEqual(self.build(FAKE_BUILD_PLATFORM="linux/arm64").returncode, 0); self.assertIn("跨架构", self.out)
        self.assertNotEqual(self.build(FAKE_BUILD_RESOURCES="low").returncode, 0)
        self.assertIsNone(self.first("mkdir -p")); self.assertIsNone(self.first("tar -x"))

    def test_build_snippet_binds_task_tags_resource_caps_and_domain_without_prune(self):
        self.assertNotEqual(self.build().returncode, 0, "fake remote build stops with 99")
        order = [self.first("bash -s -- resources"), self.first("mkdir -p"), self.first("tar -x -C"), self.first("bash -s /var/tmp/ai-platform-image-build")]
        self.assertTrue(all(i is not None for i in order), self.lines); self.assertEqual(order, sorted(order))
        main = self.lines[order[-1]]
        self.assertIn(" legacy 4608 256 ai.pkuailab.com 8 4864 100000", main)
        body = self.capture.read_text()
        for needle in ('--memory="${CAP}m" --memory-swap="${CAP}m" --cpu-shares="$SHARES"', '--build-arg "CUSTOMER_DOMAIN=$DOMAIN"',
                       '-t "ai-platform-backend:$TASK"', '-t "ai-platform-frontend:$TASK"', 'docker save', 'resources "$MIN_GIB" "$MIN_MIB" "$MIN_INODES" image-build'):
            self.assertIn(needle, body)
        for forbidden in ("docker image prune", "docker system prune", "docker builder prune"):
            self.assertNotIn(forbidden, body)
        self.assertIsNone(self.first("docker rmi"), "a failed build leaves the task directory for diagnosis")
        self.build(IMAGE_BUILD_BUILDER="buildkit")
        self.assertIn(" buildkit 4608 256 ", self.lines[self.first("bash -s /var/tmp/ai-platform-image-build")])

    def test_fetched_package_is_verified_and_remote_task_cleaned(self):
        self.stage_remote_package()
        result = self.build(FAKE_REMOTE_BUILD="done")
        self.assertEqual(result.returncode, 0, self.out)
        pkgs = [p for p in self.pkg_root.iterdir() if p.is_dir()]
        self.assertEqual(len(pkgs), 1)
        manifest = (pkgs[0] / "MANIFEST.env").read_text()
        self.assertIn(f"SOURCE_COMMIT={self.new}", manifest); self.assertIn("TAR_SHA256=" + sha256(pkgs[0] / "images.tar.gz"), manifest)
        self.assertIn("DOCKERFILE_FRONTEND_SHA256=", manifest); self.assertIn("TARGET_PLATFORM=linux/amd64", manifest)
        self.assertFalse((pkgs[0] / "images.tar.gz.part").exists())
        rmi = self.lines[self.first("docker rmi")]
        self.assertIn(f"'ai-platform-backend:{pkgs[0].name}' 'ai-platform-frontend:{pkgs[0].name}'", rmi); self.assertIn("rm -rf", rmi)
        for forbidden in ("docker image prune", "docker system prune", "docker builder prune"):
            self.assertNotIn(forbidden, "\n".join(self.lines))

    def test_fetch_checksum_mismatch_deletes_the_partial_copy_and_keeps_remote(self):
        self.stage_remote_package(sha="0" * 64)
        self.assertNotEqual(self.build(FAKE_REMOTE_BUILD="done").returncode, 0)
        self.assertIn("摘要不符", self.out)
        self.assertFalse(list(self.pkg_root.glob("*/images.tar.gz*")), "no partial or renamed tar remains locally")
        self.assertIsNone(self.first("docker rmi"))

    def test_keep_remote_and_platform_mismatch(self):
        self.stage_remote_package()
        self.assertEqual(self.build("--keep-remote", FAKE_REMOTE_BUILD="done").returncode, 0, self.out)
        self.assertIsNone(self.first("docker rmi"))
        self.stage_remote_package(platform="linux/arm64")
        self.assertNotEqual(self.build(FAKE_REMOTE_BUILD="done").returncode, 0)
        self.assertIn("不是目标", self.out)


def docker_usable():
    try:
        subprocess.run(["docker", "image", "inspect", "nginx:alpine"], check=True, capture_output=True, timeout=30)
        return True
    except Exception:
        return False


@unittest.skipUnless(docker_usable(), "local Docker with nginx:alpine present is required")
class RealImageRoundTrip(unittest.TestCase):
    """A small real image: legacy build with the same caps, save|gzip, remove, load, identity preserved, load is idempotent."""

    def test_identity_survives_save_load_and_reload(self):
        tag = f"ai-platform-roundtrip:v-{os.getpid():07x}-20261014_000000"
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "Dockerfile").write_text(f"FROM nginx:alpine\nENV CUSTOMER_DOMAIN=roundtrip.test\nRUN echo {tag} > /roundtrip.txt\n")
            build = subprocess.run(["docker", "build", "--memory=512m", "--memory-swap=512m", "--cpu-shares=256", "-t", tag, tmp],
                                   env=os.environ | {"DOCKER_BUILDKIT": "0"}, capture_output=True, text=True, timeout=300)
            if build.returncode != 0:
                self.skipTest("legacy builder with --memory not available here: " + build.stderr[-200:])
            try:
                before = subprocess.check_output(["bash", str(PREFLIGHT), "image-identity", tag], text=True).strip()
                self.assertIn("platform=linux/", before); self.assertIn("customer_domain=roundtrip.test", before)
                tar = Path(tmp) / "images.tar.gz"
                with open(tar, "wb") as out:
                    save = subprocess.Popen(["docker", "save", tag], stdout=subprocess.PIPE)
                    gz = subprocess.Popen(["gzip", "-1"], stdin=save.stdout, stdout=out)
                    save.stdout.close(); self.assertEqual(gz.wait(), 0); self.assertEqual(save.wait(), 0)
                digest = sha256(tar)
                subprocess.run(["docker", "rmi", tag], check=True, capture_output=True)
                self.assertNotEqual(subprocess.run(["bash", str(PREFLIGHT), "image-identity", tag], capture_output=True).returncode, 0)
                self.assertEqual(subprocess.run(["bash", "-c", f"echo '{digest}  {tar}' | sha256sum -c --status"]).returncode, 0)
                subprocess.run(["docker", "load", "-i", str(tar)], check=True, capture_output=True, timeout=300)
                after = subprocess.check_output(["bash", str(PREFLIGHT), "image-identity", tag], text=True).strip()
                self.assertEqual(before, after, "image ID, platform and ENV must survive save/load")
                subprocess.run(["docker", "load", "-i", str(tar)], check=True, capture_output=True, timeout=300)
                self.assertEqual(after, subprocess.check_output(["bash", str(PREFLIGHT), "image-identity", tag], text=True).strip(), "loading twice is idempotent")
                self.assertEqual(subprocess.run(["bash", str(PREFLIGHT), "arch"], capture_output=True, text=True).stdout.strip(), after.split("platform=")[1].split()[0])
            finally:
                subprocess.run(["docker", "rmi", "-f", tag], capture_output=True)


if __name__ == "__main__":
    unittest.main()
