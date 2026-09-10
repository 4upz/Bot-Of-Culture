"""Exercise automatic release ordering and gates without production access."""
import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
IMAGE = 'gcr.io/bot-of-culture/bot-of-culture@sha256:' + 'a' * 64
CURRENT = 'gcr.io/bot-of-culture/bot-of-culture@sha256:' + 'b' * 64
COMMIT = 'c' * 40


class AutoRolloutTests(unittest.TestCase):
    def run_case(self, case='success', order='200'):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            (state / 'accepted-image').write_text(CURRENT + '\n')
            (state / 'last-deploy-order').write_text('300' if case == 'stale' else '100')
            if case == 'maintenance':
                (state / 'maintenance').touch()
            script = state / 'startup-script.sh'
            script.write_text('#!/bin/bash\nprintf "%s\\n" "$*" > "$BOT_STATE_DIR/called"\n' + ('exit 1\n' if case == 'failure' else 'printf "%s\\n" "$2" > "$BOT_STATE_DIR/accepted-image"\n'))
            checksum = hashlib.sha256(script.read_bytes()).hexdigest()
            if case == 'script_changed':
                checksum = 'd' * 64
            (state / 'docker').write_text('#!/bin/bash\necho "' + (IMAGE if case == 'drift' else CURRENT) + '"\n')
            (state / 'flock').write_text('#!/bin/bash\nexit ' + ('1' if case == 'locked' else '0') + '\n')
            for name in ['docker', 'flock']:
                (state / name).chmod(0o755)
            env = dict(os.environ, PATH=directory + ':' + os.environ['PATH'], BOT_STATE_DIR=directory)
            result = subprocess.run(['bash', str(ROOT / 'scripts/deployment/auto-rollout.sh'), IMAGE, order, COMMIT, checksum], env=env, text=True, capture_output=True)
            files = {name: (state / name).read_text() if (state / name).exists() else None for name in ['called', 'accepted-image', 'accepted-commit', 'last-deploy-order']}
            return result, files

    def test_uses_current_accepted_image_for_rollback_and_records_commit(self):
        result, files = self.run_case()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files['called'], f'auto-rollout {IMAGE} {CURRENT} schema-compatible\n')
        self.assertEqual(files['accepted-commit'], COMMIT + '\n')
        self.assertEqual(files['last-deploy-order'], '200\n')

    def test_older_build_is_skipped_without_touching_running_release(self):
        result, files = self.run_case('stale')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(files['called'])
        self.assertEqual(files['accepted-image'], CURRENT + '\n')

    def test_maintenance_lock_script_mismatch_and_container_drift_stop_rollout(self):
        for case in ['maintenance', 'locked', 'script_changed', 'drift']:
            with self.subTest(case=case):
                result, files = self.run_case(case)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(files['called'])

    def test_failed_rollout_is_not_recorded_as_accepted(self):
        result, files = self.run_case('failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(files['accepted-commit'])
        self.assertEqual(files['accepted-image'], CURRENT + '\n')

    def test_invalid_order_cannot_reach_rollout(self):
        result, files = self.run_case(order='200; touch unsafe')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(files['called'])


if __name__ == '__main__':
    unittest.main()
