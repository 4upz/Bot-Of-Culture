"""Offline safety tests: no Docker daemon, network, or production credentials."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
IMAGE = 'gcr.io/bot-of-culture/bot-of-culture@sha256:' + 'a' * 64
ROLLBACK = 'gcr.io/bot-of-culture/bot-of-culture@sha256:' + 'b' * 64

class RolloutTests(unittest.TestCase):
    def run_case(self, failure):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            (base / 'runtime.env').write_text('REVIEW_MIGRATION_READY=true\nWEB_ENABLED=true\nPUBLIC_WEB_BASE_URL=https://example.test\nREVIEW_WEB_TRUSTED_PROXY_IPS=172.17.0.1\n')
            (base / 'runtime.env').chmod(0o600)
            (base / 'docker').write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *'network inspect '*) echo 172.17.0.1;;
  *'pull '*) test "$FAILURE" != pull;;
  *'run --rm '*) test "$FAILURE" != config;;
  *'create --name bot-of-culture-staged-'*) test "$FAILURE" != create;;
  *'image inspect '*) echo sha256:existing;;
  *'inspect --format {{.State.Running}}'*) echo true;;
  *'inspect --format {{.RestartCount}}'*) echo 0;;
  *'inspect --format {{.Id}}'*) if test "$FAILURE" = no_old; then exit 1; else echo old-container; fi;;
  *'logs '*) if test "$FAILURE" != readiness; then echo 'Review web listening on 8080'; if test "$FAILURE" = large_logs; then for ((n=0; n<10000; n++)); do echo 'additional startup output after readiness marker'; done; fi; fi;;
  *) true;;
esac
''')
            (base / 'df').write_text('#!/bin/bash\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\nif test "$FAILURE" = space; then echo "disk 100 90 10 90% /"; else echo "disk 9000000 1 8000000 1% /"; fi\n')
            (base / 'curl').write_text('#!/bin/bash\necho \'{"access_token":"test"}\'\n')
            (base / 'sleep').write_text('#!/bin/bash\nexit 0\n')
            for name in ('docker', 'df', 'curl', 'sleep'):
                (base / name).chmod(0o755)
            env = dict(os.environ, PATH=str(base) + ':' + os.environ['PATH'], BOT_STATE_DIR=str(base), CALLS=str(base / 'calls'), FAILURE=failure)
            result = subprocess.run(['bash', str(ROOT / 'startup-script.sh'), 'rollout', IMAGE, ROLLBACK, 'schema-compatible'], env=env, capture_output=True, text=True)
            calls = (base / 'calls').read_text() if (base / 'calls').exists() else ''
            return result, calls

    def test_boot_firewall_requires_both_approval_flags_and_is_idempotent(self):
        for flags in ((), ('caddy-enabled',), ('public-ingress-approved',), ('caddy-enabled', 'public-ingress-approved')):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as directory:
                base = pathlib.Path(directory)
                (base / 'runtime.env').touch()
                (base / 'Caddyfile').touch()
                for flag in flags:
                    (base / flag).touch()
                (base / 'iptables').write_text("#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$CALLS\"\nif [[ $2 == -C ]]; then [[ -e \"$BOT_STATE_DIR/rule-$7\" ]]; else touch \"$BOT_STATE_DIR/rule-$7\"; fi\n")
                (base / 'docker').write_text("#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$CALLS\"\n")
                for command in ('iptables', 'docker'):
                    (base / command).chmod(0o755)
                env = dict(os.environ, PATH=str(base) + ':' + os.environ['PATH'], BOT_STATE_DIR=directory, BOT_ETC_DIR=str(base / 'etc'), CADDY_CONFIG_PATH=str(base / 'Caddyfile'), CALLS=str(base / 'calls'))
                for _ in range(2):
                    result = subprocess.run(['bash', str(ROOT / 'startup-script.sh'), 'boot'], env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                calls = (base / 'calls').read_text() if (base / 'calls').exists() else ''
                if len(flags) < 2:
                    self.assertEqual(calls, '')
                else:
                    self.assertEqual(calls.count('-A INPUT'), 2)
                    self.assertIn('--dport 80 -j ACCEPT', calls)
                    self.assertIn('--dport 443 -j ACCEPT', calls)

    def test_rollout_requires_explicit_compatibility_attestation(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['bash', str(ROOT / 'startup-script.sh'), 'rollout', IMAGE, ROLLBACK], env=dict(os.environ, BOT_STATE_DIR=directory), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('explicit schema-compatible rollback attestation required', result.stderr)

    def test_boot_maintenance_gate_never_starts_a_container(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            (base / 'runtime.env').touch()
            (base / 'maintenance').touch()
            result = subprocess.run(['bash', str(ROOT / 'startup-script.sh'), 'boot'], env=dict(os.environ, BOT_STATE_DIR=directory), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('maintenance gate is active', result.stderr)

    def test_preflight_failures_never_stop_current_bot(self):
        for failure in ('space', 'pull', 'config', 'create'):
            with self.subTest(failure=failure):
                result, calls = self.run_case(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('stop bot-of-culture', calls)
                self.assertNotIn('system prune', calls)

    def test_large_startup_logs_do_not_false_fail_readiness(self):
        result, calls = self.run_case('large_logs')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('create --name bot-of-culture ', calls)

    def test_success_retains_previous_container(self):
        result, calls = self.run_case('none')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('rename bot-of-culture bot-of-culture-retained-', calls)
        self.assertNotIn('rm bot-of-culture-retained', calls)

    def test_first_rollout_without_existing_container_succeeds(self):
        result, calls = self.run_case('no_old')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('rename bot-of-culture bot-of-culture-retained-', calls)
        self.assertNotIn('stop bot-of-culture', calls)
        self.assertIn('rename bot-of-culture-staged-', calls)

    def test_failed_readiness_uses_only_explicit_compatible_rollback(self):
        result, calls = self.run_case('readiness')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(ROLLBACK, calls)
        self.assertNotIn('start bot-of-culture-retained', calls)
        self.assertIn('create --name bot-of-culture ', calls)
        self.assertIn('rename bot-of-culture-staged-', calls)
        self.assertTrue(calls.rstrip().endswith('stop bot-of-culture'))

if __name__ == '__main__':
    unittest.main()
