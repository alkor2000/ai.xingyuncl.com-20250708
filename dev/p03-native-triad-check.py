"""Run Identity's pinned triad harness on current P03 bytes; never write peer evidence.

Only synthetic, self-owned databases are created by the harness. Protocol and Go
provider/receiver implementations are read-only inputs; the harness checks their
hashes before and after. Its small driver is pinned to a private temporary copy
so another task may update its own driver/evidence without corrupting this run.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
IDENTITY = ROOT.parent / 'pkuailab-id'
TRIAD = IDENTITY / 'dev/i03/triad'
OUT = ROOT / 'storage/private/p03-handoff-validation/native-triad'


def main():
    sources = {p.name: p.read_bytes() for p in TRIAD.iterdir() if p.is_file() and p.name != 'result.json'}
    pinned_hashes = {str(TRIAD/name): hashlib.sha256(body).hexdigest() for name, body in sources.items()}
    with tempfile.TemporaryDirectory(prefix='p03-native-triad-harness-') as directory:
        target = Path(directory)/"dev/i03/triad"
        target.mkdir(parents=True)
        for name, body in sources.items():
            (target/name).write_bytes(body)
        spec = importlib.util.spec_from_file_location('identity_native_triad', target/'run.py')
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        original_run = harness.run
        harness.IDENTITY, harness.P03 = IDENTITY, ROOT
        # The imported helper's default cwd was bound when its pinned file loaded.
        def run(args, *, cwd=IDENTITY, **kwargs):
            return original_run(args, cwd=cwd, **kwargs)
        harness.run = run
        harness.run(['git', 'apply', '--reverse', '--check', str(target/'p03-native-endpoints.patch')], cwd=ROOT)
        harness.main()
        result = json.loads((target/'result.json').read_text())
        if result.get('source_client_mode') != 'existing_native_profile':
            raise RuntimeError('Current P03 bytes were not consumed unchanged')
        result.update(actual_current_P03=True, p03_patch_applied_during_test=False,
                      identity_harness_sha256=pinned_hashes,
                      upstream_driver_changed_during_run=any(not Path(path).is_file() or hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha for path,sha in pinned_hashes.items()),
                      p03_runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        OUT.mkdir(parents=True, exist_ok=True, mode=0o700)
        output = OUT/'result.json'
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
        output.chmod(0o600)
    print('Current P03 native-draft: six scenarios passed; source bytes unmodified; private P03 evidence saved')


if __name__ == '__main__':
    main()
