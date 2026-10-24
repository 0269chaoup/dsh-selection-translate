#!/usr/bin/env python3
"""Boot the real DSH Host in a throwaway DSH_HOME and prove one plugin row
(`dsh-selection-translate`) is accepted by the live composition.

What this answers, and nothing more:

  A  the row reaches the composed tree and mounts      (`--dump-config` + boot log)
  B  the Service constructor actually ran              (`[selection-translate] ready:` log line)
  C  the `./typert` artifact passes the real loader    (boot log has no typert error, plus a
                                                       direct call of the loader's own
                                                       `validateTypertManifest()`)
  D  the browser half is served                        (HTTP GET of the bundle URL the shell
                                                       itself advertises)
  E  the row's settings form is editable here          (`settings.describe()` lists the row's
                                                       fields, `saveSettings` writes and the
                                                       revision advances)

It is deliberately *not* a functional test: no model is called, no selection is
translated, no overlay is clicked. A green run is a precondition, not behavior
evidence.

One trap this script has to avoid: the package is installed as a profile **bundle**,
so the Host's bundle layer already inserts its `- id: selection-translate` row. The
sandbox profile patch therefore must *not* append that row a second time: with a
duplicate `- insert:` row in the profile patch, `configEditor.edit()`'s post-write
read-back composes the shipped insert defaults instead of the written override and
refuses every write ("overridden by a home patch or command-line overlay"), which
shows up as "settings not writable" and looks exactly like a plugin defect.
`filter_insert_block()` skips every row id a bundle layer (or the profile patch)
already inserts; check E is what proves the result.

Safety: `~/.dsh` is read-only here. Everything writable lives under
`<repo>/.verify/`; the only process this kills is the one it spawned (its own
process group).

Usage:
  ./scripts/verify-host-boot.py                 # full run, keeps logs under .verify/
  ./scripts/verify-host-boot.py --port 55998
  ./scripts/verify-host-boot.py --json          # machine-readable receipt
  ./scripts/verify-host-boot.py --no-http       # skip check D
  ./scripts/verify-host-boot.py --serve         # leave the Host running for manual
                                                # browser testing (Ctrl-C to stop)

`--serve` is the keep-alive mode: it builds the same sandbox, boots the same Host,
and then *does not* run the checks or kill anything. It prints the tokenized
browser URL the Host minted and waits. While it waits, every Host stdout/stderr
line is appended to `<sandbox>/boot.stdout.log` / `<sandbox>/boot.stderr.log`,
and warning/error-looking lines are echoed live to this terminal with a
`[host] ` (stdout) or `[host:err] ` (stderr) prefix, so an error raised while you
click the selection overlay is visible here at once. On Ctrl-C / SIGTERM it
stops only its own process group and keeps the sandbox, logs included.

The sandbox DSH_HOME root gets a *symlink* (never a copy: credentials must not
land in repository content) to `~/.dsh/.credentials.yaml` when that file exists,
so a real provider call has a chance to succeed. If the provider still reports
missing credentials (e.g. no `WORKBUDDY_API_KEY` in the environment), that is the
sandbox being keyless — not the plugin being broken. `--serve` and `--json` are
mutually exclusive.

Exit codes: 0 every check passed (D optional) · 1 a check failed (or the Host died while
serving) · 2 harness/boot failure.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import http.cookiejar
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[1]
PACKAGE = "dsh-selection-translate"
SERVICE_NAME = "selectionTranslate"
SERVICE_KEY = "selectionTranslate"
READY_MARKER = "[selection-translate] ready:"
PROBE_PKG = "dsh-boot-probe"
# What `build_sandbox` did with the profile patch: which repo rows were appended and
# which were skipped because another layer already inserts them. Read into the report.
PATCH_NOTE: Dict[str, Any] = {"appended": [], "skipped": []}
DEFAULT_APP = "/Applications/DeepSeek Harness.app"
DEFAULT_PORT = 55999
CREDENTIALS = ".credentials.yaml"
# The profile's `llm.providers` row names this variable in `apiKeyEnv`; when it is
# absent the sandbox Host has no key and provider calls fail — not a plugin defect.
KEY_ENV = "WORKBUDDY_API_KEY"
# The Host's own boot line: `dsh web: http://127.0.0.1:<port>/?token=<secret>`.
BROWSER_URL = re.compile(r"https?://\S*token=\S+")
# Lines worth echoing to the terminal in --serve mode (and their stack/continuation
# lines). Deliberately loose: a false positive costs one terminal line, a false
# negative means the user cannot see why the overlay failed.
DIAGNOSTIC = re.compile(
    r"warn|error|fail|cannot|unable|exception|uncaught|unhandled|rejected|refused|\berr_[a-z]+",
    re.IGNORECASE,
)


# ── paths ────────────────────────────────────────────────────────────────────


def fail(message: str) -> None:
    sys.stderr.write("verify-host-boot: %s\n" % message)
    raise SystemExit(2)


def resolve_paths(app: str) -> Tuple[Path, Path, Path, Path]:
    """Return (source DSH home, real profile dir, CLI entry, Electron binary)."""
    home = Path(os.environ.get("DSH_HOME_SRC", str(Path.home() / ".dsh"))).expanduser()
    profile = home / "profiles" / "desktop"
    app_path = Path(app).expanduser()
    electron = app_path / "Contents" / "MacOS" / "DeepSeek Harness"
    asar = app_path / "Contents" / "Resources" / "app.asar"
    cli = asar / "dsh" / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
    if not profile.is_dir():
        fail("profile not found: %s" % profile)
    if not electron.exists():
        fail("Electron binary not found: %s" % electron)
    if not asar.exists():
        fail("app.asar not found: %s" % asar)
    return home, profile, cli, electron


# ── sandbox ──────────────────────────────────────────────────────────────────


def insert_block() -> str:
    """Return the repo patch's `- insert:` item with its comment header stripped."""
    text = (REPO / "cordis.patch.yml").read_text()
    lines = text.splitlines()
    start = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            continue
        start = index
        break
    block = "\n".join(lines[start:]).rstrip()
    if "- insert:" not in block:
        fail("cordis.patch.yml has no `- insert:` row to append")
    return block


# A row item inside an `- insert:` block: `<indent>- id: <row id>`.
INSERT_ROW = re.compile(r"^(\s*)-\s*id:\s*(['\"]?)([^\s'\"#]+)\2")


def insert_row_ids(text: str) -> List[str]:
    """Row ids the `- insert:` blocks of one patch document would add, in order.

    Text-level on purpose: these patch files are hand-maintained YAML and the only
    shape that matters here is `- insert:` followed by its `- id: <row>` items, so a
    dependency on a YAML parser would add a failure mode without adding accuracy.
    @param text - patch document.
    @returns inserted row ids (duplicates preserved).
    """
    ids: List[str] = []
    insert_indent: Optional[int] = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if stripped.startswith("- insert:"):
            insert_indent = indent
            continue
        match = INSERT_ROW.match(line)
        if match is not None and insert_indent is not None and len(match.group(1)) > insert_indent:
            ids.append(match.group(3))
            continue
        if insert_indent is not None and indent <= insert_indent:
            insert_indent = None  # a sibling patch verb ends the block
    return ids


def filter_insert_block(block: str, taken: Dict[str, str]) -> Optional[str]:
    """Drop the `- insert:` items whose row id another layer already provides.

    The plugin is installed as a profile **bundle** (`dsh.bundle.patch`), so the
    Host's own bundle layer already inserts `- id: selection-translate` at boot.
    Appending the same item again from the profile patch makes the sandbox report a
    settings form that cannot be saved, and the measured reason is a precedence
    read-back, not a missing row: `configEditor.edit()` appends the `{id, name,
    config}` override to the profile patch, then re-composes *that patch alone* and
    refuses to persist unless the row it composes carries the written config. With a
    duplicate `- insert:` row in the same document, the composed row is the insert
    row's shipped defaults, so the write is refused with `Configuration for
    "<row>" is overridden by a home patch or command-line overlay` — which surfaces
    in the GUI as "settings not writable" and looks exactly like a plugin defect.
    (Two rows with one id would additionally drop out of `configEditor.entries()`,
    which keeps only ids that occur once; the loader composes one row here, so the
    read-back is what actually fails.)
    Hence: never insert a row id that a bundle layer (or the profile patch itself)
    already inserts.
    @param block - `- insert:` block whose items may be filtered.
    @param taken - row id -> layer that already provides it.
    @returns the block with only the missing rows, or None when nothing is missing.
    """
    lines = block.splitlines()
    head: List[str] = []
    items: List[Tuple[str, List[str]]] = []
    current: Optional[List[str]] = None
    for line in lines:
        match = INSERT_ROW.match(line)
        if match is not None and len(match.group(1)) > 0:
            current = [line]
            items.append((match.group(3), current))
        elif current is None:
            head.append(line)
        else:
            current.append(line)
    kept = [text for row_id, text in items if row_id not in taken]
    if not kept:
        return None
    return "\n".join(head + [line for item in kept for line in item]).rstrip()


def bundle_row_ids(profile_dir: Path) -> Tuple[List[str], Dict[str, str]]:
    """Row ids the profile's bundle layers insert, plus which layer supplies each.

    A bundle contributes its `cordis.patch.yml` (`dsh.bundle.patch`) as a layer, so
    the ids here are rows the Host will create *without* any help from the profile
    patch this script writes.
    @param profile_dir - sandbox profile directory whose `node_modules` is linked.
    @returns (ids, id -> bundle name).
    """
    rows: List[str] = []
    owner: Dict[str, str] = {}
    try:
        manifest = json.loads((profile_dir / "package.json").read_text())
    except (OSError, ValueError):
        return rows, owner
    bundles = ((manifest.get("dsh") or {}).get("profile") or {}).get("bundles") or []
    for name in bundles:
        manifest_path = profile_dir / "node_modules" / name / "package.json"
        try:
            data = json.loads(manifest_path.read_text())
        except (OSError, ValueError):
            continue
        patch = ((data.get("dsh") or {}).get("bundle") or {}).get("patch")
        if not isinstance(patch, str):
            continue
        try:
            text = (manifest_path.parent / patch).read_text()
        except OSError:
            continue
        for row_id in insert_row_ids(text):
            rows.append(row_id)
            owner.setdefault(row_id, str(name))
    return rows, owner


def build_sandbox(source_profile: Path, work_root: Path, with_probe: bool = True) -> Tuple[Path, Path]:
    """Create <work_root>/dsh-home/profiles/verify-boot mirroring the desktop profile.

    `with_probe=False` leaves the probe row out: the probe deliberately exits the
    process after 120 s, which is fine for a bounded check run and fatal for the
    keep-alive `--serve` mode.
    """
    sandbox_home = work_root / "dsh-home"
    name = "verify-boot"
    target = sandbox_home / "profiles" / name
    if sandbox_home.exists():
        shutil.rmtree(sandbox_home)
    target.mkdir(parents=True)

    for filename in ("package.json", "cordis.yml", "cordis.patch.yml", "compatibility.json"):
        source = source_profile / filename
        if source.is_file():
            shutil.copy2(source, target / filename)
    if not (target / "cordis.patch.yml").exists():
        fail("profile has no cordis.patch.yml: %s" % source_profile)

    # Declare this package as a profile dependency, exactly as a real install
    # would (`dsh agent-pipeline` uses the same `file:` form). The Host resolves
    # plugin packages through the profile manifest, so a row that is only
    # symlinked into node_modules mounts but is invisible to the typert loader.
    manifest_path = target / "package.json"
    manifest = json.loads(manifest_path.read_text())
    dependencies = manifest.setdefault("dependencies", {})
    dependencies[PACKAGE] = "file:%s" % REPO
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    # node_modules as a directory of symlinks: the real entries, then this package.
    # When the real profile already has this package installed (post-install
    # verification), mirror *that* entry instead of the repo checkout, so the run
    # proves the installed copy resolves — not the working tree.
    real_modules = source_profile / "node_modules"
    modules = target / "node_modules"
    modules.mkdir()
    installed = None
    if real_modules.is_dir():
        for entry in real_modules.iterdir():
            if entry.name == PACKAGE:
                installed = entry
                continue
            try:
                os.symlink(os.path.realpath(entry), modules / entry.name)
            except OSError:
                pass
    # `DSH_VERIFY_PACKAGE_SOURCE=repo` links the working tree instead of the
    # installed copy: post-rebuild iteration without touching ~/.dsh, at the cost
    # of no longer proving the installed copy resolves.
    from_repo = os.environ.get("DSH_VERIFY_PACKAGE_SOURCE", "").strip() == "repo"
    os.symlink(os.path.realpath(REPO if from_repo else (installed or REPO)), modules / PACKAGE)

    # The repo bundle patch, appended as the last profile layer — minus the rows the
    # bundle layers already insert (see `filter_insert_block`: a second row with the
    # same id is silently dropped from `configEditor.entries()`, which is what makes
    # the sandbox's settings form read-only).
    patch = target / "cordis.patch.yml"
    existing = patch.read_text()
    bundle_ids, bundle_owner = bundle_row_ids(target)
    taken: Dict[str, str] = {}
    for row_id in insert_row_ids(existing):
        taken.setdefault(row_id, "profile.cordis.patch.yml")
    for row_id in bundle_ids:
        taken.setdefault(row_id, "bundle:%s" % bundle_owner.get(row_id, "?"))
    repo_block = insert_block()
    block = filter_insert_block(repo_block, taken)
    appended = insert_row_ids(block) if block is not None else []
    PATCH_NOTE["appended"] = appended
    PATCH_NOTE["skipped"] = [
        {"id": row_id, "providedBy": taken[row_id]}
        for row_id in insert_row_ids(repo_block)
        if row_id in taken
    ]
    if appended:
        patch.write_text(existing.rstrip() + "\n\n" + block + "\n")
    else:
        sys.stderr.write(
            "verify-host-boot: every row of the repo cordis.patch.yml is already provided "
            "by another layer (%s); the sandbox profile patch is left untouched\n"
            % ", ".join("%s<-%s" % (row_id, taken[row_id]) for row_id in insert_row_ids(repo_block))
        )

    # Probe row: reports what the live tree did with our row.
    if with_probe:
        probe = modules / PROBE_PKG
        probe.mkdir()
        (probe / "package.json").write_text(
            json.dumps({"name": PROBE_PKG, "version": "0.0.0", "type": "module", "main": "index.js"}) + "\n"
        )
        (probe / "index.js").write_text(PROBE_JS)
        patch.write_text(patch.read_text().rstrip() + "\n\n- insert:\n    - id: %s\n      name: %s\n" % (PROBE_PKG, PROBE_PKG))
    return sandbox_home, target


def link_credentials(source_home: Path, sandbox_home: Path) -> Optional[Path]:
    """Symlink (never copy) `~/.dsh/.credentials.yaml` into the sandbox DSH_HOME root.

    A symlink keeps the key material out of anything that snapshots the workspace
    (`.verify/` is gitignored, but a copy would still put a live secret on disk in
    a second place). Returns the sandbox-side path, or None when the source is absent.
    """
    source = source_home / CREDENTIALS
    if not source.exists():
        return None
    target = sandbox_home / CREDENTIALS
    try:
        if target.is_symlink() or target.exists():
            target.unlink()
        os.symlink(os.path.realpath(source), target)
    except OSError as error:
        sys.stderr.write("verify-host-boot: could not link credentials (%s)\n" % error)
        return None
    return target


# ── probe plugin ─────────────────────────────────────────────────────────────

PROBE_JS = r"""const TARGET = 'dsh-selection-translate'
const SERVICE = 'selectionTranslate'
const ROW = 'selection-translate'
const READY_MARKER = '[selection-translate] ready:'
/** The cordis logger keeps a bounded in-memory buffer of every message; info-level
 * lines have no console exporter in this host, so the buffer is the only place the
 * plugin's own ready line is readable. */
const readReadyLine = (ctx) => {
  try {
    const buffer = ctx.logger && Array.isArray(ctx.logger.buffer) ? ctx.logger.buffer : []
    for (const message of buffer) {
      const args = Array.isArray(message.args) ? message.args : []
      if (typeof args[0] === 'string' && args[0].includes(READY_MARKER)) {
        return { name: message.name, type: message.type, line: args[0] }
      }
    }
  } catch (error) { return { error: String(error) } }
  return null
}
/**
 * Prove the settings form of this row is actually editable here.
 *
 * Reads what the Plugins page reads (`settings.describe()`), then writes through the
 * plugin's own `saveSettings()` and reads it back. `configEditor.entries()` is
 * reported separately because it is the list that drops duplicate row ids: a row id
 * inserted twice (bundle layer + profile patch) is present in the Loader tree but
 * absent from the editable set, and a form that never sees its row cannot be saved.
 */
const settingsProbe = async (ctx) => {
  const out = { ok: false }
  try {
    const settings = ctx.get('settings')
    if (settings === undefined) { out.error = 'no settings service in this composition'; return out }
    out.serviceWritable = settings.writable
    const described = settings.describe()
    out.namespaces = described.map((row) => row.ns)
    const row = described.find((item) => item.ns === ROW)
    if (row === undefined) { out.error = 'the settings service does not describe this row'; return out }
    out.ns = row.ns
    // `describe()` hands the form schema over in schemastery's reference-graph form
    // (`{uid, refs}`), so the object's field names live at `refs[uid].dict`.
    const schemaJson = row.schema || {}
    const schemaRoot = (schemaJson.refs && schemaJson.refs[schemaJson.uid]) || schemaJson
    out.fields = Object.keys(schemaRoot.dict || {})
    out.applies = row.applies
    out.revisionBefore = row.revision
    out.styleBefore = row.value && row.value.style
    const entries = [...ctx.loader.entries()]
    out.loaderRowsWithId = entries.filter((entry) => entry.options && entry.options.id === row.ns).length
    const editor = ctx.get('configEditor')
    out.configEditorEntries = editor === undefined ? null
      : editor.entries().filter((entry) => entry.options && entry.options.id === row.ns).length

    const service = ctx.get(SERVICE)
    if (service === undefined) { out.error = 'the plugin service is absent'; return out }
    const saved = await service.saveSettings(
      { patch: { style: 'literal' }, expectedRevision: row.revision },
      new AbortController().signal,
    )
    out.saved = { style: saved.style, revision: saved.revision, namespace: saved.namespace }
    const after = settings.describe().find((item) => item.ns === row.ns)
    out.revisionAfter = after && after.revision
    out.styleAfter = after && after.value && after.value.style
    const restored = await service.saveSettings(
      { patch: { style: out.styleBefore }, expectedRevision: out.revisionAfter },
      new AbortController().signal,
    )
    out.styleRestored = restored.style
    out.revisionRestored = restored.revision
    out.error = null
    out.ok = out.styleAfter === 'literal'
      && typeof out.revisionAfter === 'number'
      && typeof out.revisionBefore === 'number'
      && out.revisionAfter > out.revisionBefore
      && out.styleRestored === out.styleBefore
      && out.fields.length > 0
      && out.configEditorEntries === 1
  } catch (error) {
    out.error = String((error && error.message) || error)
    out.reason = (error && error.data && error.data.reason) || null
  }
  return out
}
export const name = 'boot-probe'
export const inject = ['loader']
export function apply(ctx) {
  const started = Date.now()
  let signature = null
  let stable = 0
  const entriesOf = () => [...ctx.loader.entries()]
    .filter((entry) => entry.options && entry.options.name === TARGET)
    .map((entry) => ({
      id: entry.options.id,
      state: entry.fiber && entry.fiber.state !== undefined ? entry.fiber.state : null,
      disabled: entry.disabled === true,
    }))
  const tick = async () => {
    let entries = []
    let service = false
    let descriptors = []
    let typertError = null
    try { entries = entriesOf() } catch (error) { typertError = String(error) }
    try { service = ctx.get(SERVICE) !== undefined } catch (error) { typertError = String(error) }
    try {
      const typert = ctx.get('typert')
      if (typert) descriptors = typert.local.list().filter((item) => item.service === SERVICE)
    } catch (error) { typertError = String(error) }
    const current = JSON.stringify([entries, service, descriptors.length])
    if (current === signature) stable += 1
    else { stable = 0; signature = current }
    const ready = readReadyLine(ctx)
    const elapsed = Date.now() - started
    if (stable >= 1 && service && (ready !== null || elapsed > 20000)) {
      console.log('PROBE_ENTRY ' + JSON.stringify(entries))
      console.log('PROBE_LOG ' + JSON.stringify(ready))
      console.log('PROBE_SERVICE ' + JSON.stringify({ key: SERVICE, present: service }))
      console.log('PROBE_TYPERT ' + JSON.stringify({
        count: descriptors.length,
        ids: descriptors.map((item) => item.id),
        methods: descriptors.map((item) => `${item.namespace}.${item.method}`),
        error: typertError,
      }))
      // Runs before PROBE_READY: the caller stops the Host as soon as it reads that
      // line, so a probe printed afterwards would race the shutdown.
      try {
        console.log('PROBE_SETTINGS ' + JSON.stringify(await settingsProbe(ctx)))
      } catch (error) {
        console.log('PROBE_SETTINGS ' + JSON.stringify({ ok: false, error: String(error) }))
      }
      console.log('PROBE_READY')
      // Stay alive so the caller can probe the HTTP surface, then die of old age.
      setTimeout(() => process.exit(4), 120000)
      return
    }
    if (elapsed > 60000) {
      console.log('PROBE_ENTRY ' + JSON.stringify(entries))
      console.log('PROBE_LOG ' + JSON.stringify(ready))
      console.log('PROBE_SERVICE ' + JSON.stringify({ key: SERVICE, present: service }))
      console.log('PROBE_TYPERT ' + JSON.stringify({ count: descriptors.length, error: typertError }))
      console.log('PROBE_TIMEOUT')
      return
    }
    setTimeout(tick, 500)
  }
  setTimeout(tick, 1200)
}
"""


# ── boot ─────────────────────────────────────────────────────────────────────


class Boot(object):
    """One live Host process plus its captured output.

    With `log_dir` set, every line is also appended to `<log_dir>/boot.stdout.log`
    / `boot.stderr.log` as it arrives (so a long `--serve` session has durable
    logs even if the terminal scrollback is lost). With `echo_diagnostics` set,
    warning/error-looking lines are additionally echoed to the terminal.
    """

    def __init__(
        self,
        electron: Path,
        cli: Path,
        sandbox_home: Path,
        profile: str,
        port: int,
        timeout: float,
        log_dir: Optional[Path] = None,
        echo_diagnostics: bool = False,
    ):
        self.stdout: List[str] = []
        self.stderr: List[str] = []
        self.ready = threading.Event()
        self.gone = threading.Event()
        self.timed_out = False
        self.echo_diagnostics = echo_diagnostics
        self.log_paths: Dict[str, Path] = {}
        self._log_out: Optional[Any] = None
        self._log_err: Optional[Any] = None
        if log_dir is not None:
            log_dir = Path(log_dir)
            log_dir.mkdir(parents=True, exist_ok=True)
            self.log_paths["stdout"] = log_dir / "boot.stdout.log"
            self.log_paths["stderr"] = log_dir / "boot.stderr.log"
            self._log_out = self.log_paths["stdout"].open("w", encoding="utf-8")
            self._log_err = self.log_paths["stderr"].open("w", encoding="utf-8")
        env = dict(os.environ)
        env["DSH_HOME"] = str(sandbox_home)
        env["ELECTRON_RUN_AS_NODE"] = "1"
        env.pop("DSH_SNAPSHOT", None)
        self.timeout = timeout
        self.started_at = time.time()
        self.process = subprocess.Popen(
            [
                electron.as_posix(),
                cli.as_posix(),
                "--profile",
                profile,
                "--no-open",
                "--port",
                str(port),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        self._readers = [
            threading.Thread(
                target=self._pump,
                args=(self.process.stdout, self.stdout, True),
                kwargs={"log": self._log_out, "tag": "host"},
                daemon=True,
            ),
            threading.Thread(
                target=self._pump,
                args=(self.process.stderr, self.stderr, False),
                kwargs={"log": self._log_err, "tag": "host:err"},
                daemon=True,
            ),
        ]
        for reader in self._readers:
            reader.start()

    def _pump(self, stream, sink: List[str], watch_ready: bool, log: Optional[Any] = None, tag: str = "host") -> None:
        # How many following lines still belong to the diagnostic block just echoed
        # (stack frames, wrapped detail lines).
        follow = 0
        try:
            for line in stream:
                line = line.rstrip("\n")
                if log is not None:
                    try:
                        log.write(line + "\n")
                        log.flush()
                    except (OSError, ValueError):
                        pass
                if len(sink) < 50000:  # bounded: a manual session can print forever
                    sink.append(line)
                if self.echo_diagnostics and not line.startswith("PROBE_"):
                    headline = bool(DIAGNOSTIC.search(line))
                    indented = follow > 0 and (line.startswith((" ", "\t")) or line.startswith("at "))
                    if headline or indented:
                        try:
                            sys.stdout.write("[%s] %s\n" % (tag, line[:400]))
                            sys.stdout.flush()
                        except (OSError, ValueError):
                            pass
                        follow = 25 if headline else follow - 1
                    else:
                        follow = 0
                if watch_ready and (line.strip() == "PROBE_READY" or "PROBE_TIMEOUT" in line):
                    self.ready.set()
        except Exception:  # noqa: BLE001 - a closed pipe at shutdown is expected
            pass
        finally:
            if watch_ready:
                self.ready.set()
                self.gone.set()

    def close_logs(self) -> None:
        for handle in (self._log_out, self._log_err):
            if handle is None:
                continue
            try:
                handle.flush()
                handle.close()
            except (OSError, ValueError):
                pass
        self._log_out = None
        self._log_err = None

    def browser_url(self) -> Optional[str]:
        """The tokenized Web GUI URL from the Host's own `dsh web:` boot line."""
        for line in list(self.stdout):
            match = BROWSER_URL.search(line)
            if match:
                return match.group(0)
        return None

    def wait_ready(self, seconds: float) -> None:
        remaining = max(1.0, self.timeout - (time.time() - self.started_at))
        if not self.ready.wait(min(seconds, remaining)):
            self.timed_out = True

    def wait_browser_url(self, seconds: float) -> Optional[str]:
        """Wait for the Host to advertise its tokenized URL (no probe needed)."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            url = self.browser_url()
            if url is not None:
                return url
            if self.process.poll() is not None:
                return None
            time.sleep(0.2)
        return self.browser_url()

    def stop(self) -> None:
        try:
            os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
        except OSError:
            pass
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
            except OSError:
                pass
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        self.close_logs()


def run_dump_config(electron: Path, cli: Path, sandbox_home: Path, profile: str) -> Tuple[int, str, str]:
    env = dict(os.environ)
    env["DSH_HOME"] = str(sandbox_home)
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env.pop("DSH_SNAPSHOT", None)
    done = subprocess.run(
        [electron.as_posix(), cli.as_posix(), "--profile", profile, "--dump-config"],
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    return done.returncode, done.stdout, done.stderr


# ── direct loader check (C, independent of the log surface) ──────────────────

TYPER_CHECK_JS = r"""// Call the loader's own validation function against the built artifact.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const loaderUrl = process.argv[2]
const request = process.argv[3]
const pkgName = process.argv[4]

const loader = await import(loaderUrl)
const require = createRequire(request)
const manifestPath = require.resolve(pkgName + '/package.json')
const pkg = JSON.parse(await readFile(manifestPath, 'utf8'))
const exported = pkg.exports && pkg.exports[loader.TYPERT_HOST_EXPORT]
const target = typeof exported === 'string' ? exported : exported && exported.default
if (typeof target !== 'string') {
  console.log(JSON.stringify({ ok: false, step: 'export', detail: 'exports["' + loader.TYPERT_HOST_EXPORT + '"] is not a string' }))
  process.exit(1)
}
const artifact = join(dirname(manifestPath), target)
console.log(JSON.stringify({ ok: true, step: 'export', manifestPath, artifact, target }))
let module
try {
  module = await import(pathToFileURL(artifact).href)
} catch (error) {
  console.log(JSON.stringify({ ok: false, step: 'import', detail: String(error && error.stack || error) }))
  process.exit(1)
}
try {
  const manifest = loader.validateTypertManifest(pkgName, module.TYPERT)
  console.log(JSON.stringify({
    ok: true,
    step: 'validate',
    face: manifest.face,
    invocations: manifest.invocations.map((item) => ({ id: item.id, service: item.service, method: item.method, hasInput: typeof item.input === 'function', hasInvoke: typeof item.invoke === 'function' })),
    services: manifest.model.services.map((item) => ({ key: item.key, exportName: item.exportName, members: item.members.map((m) => m.name) })),
  }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, step: 'validate', detail: String(error && error.message || error) }))
  process.exit(1)
}
"""


def run_loader_check(electron: Path, sandbox_profile: Path, work_root: Path, loader_url: Path) -> Dict[str, Any]:
    script = work_root / "typert-check.mjs"
    script.write_text(TYPER_CHECK_JS)
    if not (Path(electron).parents[1] / "Resources" / "app.asar").exists():
        return {"ok": False, "detail": "app.asar not found next to %s" % electron}
    env = dict(os.environ)
    env["DSH_HOME"] = str(work_root / "dsh-home")
    env["ELECTRON_RUN_AS_NODE"] = "1"
    done = subprocess.run(
        [
            electron.as_posix(),
            script.as_posix(),
            loader_url.as_posix(),
            (sandbox_profile / "package.json").as_posix(),
            PACKAGE,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    payload: Dict[str, Any] = {"ok": False, "stdout": done.stdout.strip(), "stderr": done.stderr.strip(), "code": done.returncode}
    for line in done.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        payload.setdefault("steps", []).append(record)
        if record.get("step") == "export" and record.get("ok"):
            payload["export"] = record
        if record.get("step") == "validate":
            payload["validation"] = record
    payload["ok"] = done.returncode == 0 and payload.get("validation", {}).get("ok") is True
    return payload


# ── HTTP (D) ─────────────────────────────────────────────────────────────────


def make_opener() -> urllib.request.OpenerDirector:
    """Opener that keeps the auth cookie the Host sets when the token URL is opened."""
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def http_get(opener: urllib.request.OpenerDirector, url: str, timeout: float = 15.0) -> Tuple[int, str]:
    request = urllib.request.Request(url, headers={"accept": "*/*"})
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 - an unreachable port is a normal outcome
        return 0, str(error)


def wait_port(port: int, seconds: float) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.25)
    return False


def client_urls(port: int, package: str, browser_url: Optional[str] = None) -> Dict[str, Any]:
    """Find the exact bundle URL the shell advertises for this plugin, then fetch it."""
    evidence: Dict[str, Any] = {"index": None, "candidates": [], "attempts": [], "fetched": None, "browserUrl": browser_url}
    base = "http://127.0.0.1:%d" % port
    # No cookie: proves the Host is really gating the surface (a 2xx here would mean
    # the run is talking to something other than this Host).
    unauth_status, unauth_body = http_get(make_opener(), base + "/")
    evidence["unauthenticated"] = {"status": unauth_status, "body": unauth_body[:120]}
    opener = make_opener()
    if browser_url:
        # The Host mints a per-process token and sets an auth cookie when that URL is
        # opened; every other request (including the plugin bundle) needs it.
        http_get(opener, browser_url)
    status, body = http_get(opener, base + "/")
    evidence["index"] = {
        "status": status,
        "bytes": len(body),
        "mentionsPackage": package in body,
        "mentionsPluginsRoute": "/plugins/" in body,
    }
    if status != 200:
        evidence["index"]["error"] = body[:300]
        return evidence
    candidates: List[str] = []
    # 1. exact plugin-bundle references (`/plugins/??<id>/client.js&rev=...`)
    for match in re.finditer(r"[\"'=(]((?:/?plugins/)\?\?[^\"'\s)<>]*%s[^\"'\s)<>]*)" % re.escape(package), body):
        candidates.append(match.group(1))
    # 2. any `__DSH_BOOT__` payload, scanned for a URL that names the package
    for match in re.finditer(r"/plugins/[^\"'\s,)]*%s[^\"'\s,)]*" % re.escape(package), body):
        candidates.append(match.group(0))
    seen = set()
    ordered = []
    single = "??%s/client.js" % package
    # A shared combo that merely contains this package is weaker evidence than the
    # one-package bundle, so try the dedicated reference first.
    for item in sorted(candidates, key=lambda value: 0 if single in value else 1):
        item = item.rstrip("\\")
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    evidence["candidates"] = ordered[:8]
    for candidate in ordered[:8]:
        raw = candidate.replace("&amp;", "&")
        url = raw if raw.startswith("http") else base + "/" + raw.lstrip("/")
        status, text = http_get(opener, url)
        record = {
            "url": url,
            "status": status,
            "bytes": len(text),
            "isModuleLoaderFactory": "__ModuleLoader__.load(" in text and ('id: "%s"' % package) in text,
        }
        if status != 200:
            record["error"] = text[:200]
        evidence["attempts"].append(record)
        if status == 200 and record["isModuleLoaderFactory"]:
            evidence["fetched"] = record
            break
    return evidence


# ── keep-alive (--serve) ─────────────────────────────────────────────────────


def serve_host(
    electron: Path,
    cli: Path,
    work_root: Path,
    sandbox_home: Path,
    sandbox_profile: Path,
    port: int,
    timeout: float,
    credentials: Optional[Path],
    http_check: bool = True,
) -> int:
    """Boot the sandbox Host and hand it to the user, then clean up on Ctrl-C."""
    stop = threading.Event()

    def on_signal(signum, _frame):  # noqa: ANN001 - signal handler signature
        stop.set()

    previous = {}
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            previous[signum] = signal.signal(signum, on_signal)
        except (ValueError, OSError):
            pass

    boot = Boot(
        electron,
        cli,
        sandbox_home,
        "verify-boot",
        port,
        timeout,
        log_dir=work_root,
        echo_diagnostics=True,
    )
    try:
        url = boot.wait_browser_url(max(45.0, timeout))
        if url is None:
            tail = "\n".join((boot.stderr or [])[-12:]) or "(no stderr)"
            boot.stop()
            fail(
                "the sandbox Host never advertised a `dsh web:` URL; last stderr lines:\n%s"
                % tail
            )

        print("")
        print("── verify-boot: keep-alive sandbox " + "─" * 40)
        print("sandbox     %s" % work_root)
        print("profile     %s" % sandbox_profile)
        print("logs        %s" % (work_root / "boot.stdout.log"))
        print("            %s" % (work_root / "boot.stderr.log"))
        if credentials is not None:
            print("credentials linked  ~/.dsh/%s -> %s" % (CREDENTIALS, credentials))
        else:
            print("credentials absent  ~/.dsh/%s not found; provider calls will have no key" % CREDENTIALS)
        print("")
        print("open this in the browser:")
        print("")
        print("    %s" % url)
        print("")
        print("Keep this terminal window open. Ctrl-C stops the sandbox Host and cleans up.")
        print("Host warnings/errors are echoed below with a [host] / [host:err] prefix.")
        # The provider row resolves its key from `apiKeyEnv`. Say out loud what this
        # sandbox is missing, so a provider error is not mistaken for a broken plugin.
        key_env = os.environ.get(KEY_ENV, "")
        if credentials is None or not key_env:
            print("")
            print("Note: a model call in this sandbox can fail with a provider/auth error.")
            print("      That is the sandbox being keyless — the overlay, the Remote call and")
            print("      the error card are still real; retry after exporting the key.")
            if credentials is None:
                print("      - ~/.dsh/%s was not found, so nothing was linked." % CREDENTIALS)
            if not key_env:
                print("      - %s is not set in this terminal (the profile's provider" % KEY_ENV)
                print("        row reads it via apiKeyEnv).")
        print("─" * 72)
        sys.stdout.flush()

        # Reuse check D as a one-line sanity signal, so "it opened" is known before
        # the user reaches for the overlay. Failure here never ends the session.
        if not http_check:
            print("self-check  skipped (--no-http)")
        else:
            try:
                evidence = client_urls(port, PACKAGE, url)
                fetched = evidence.get("fetched")
                index = evidence.get("index") or {}
                if fetched:
                    print(
                        "self-check  browser half OK: GET / -> HTTP %s, bundle HTTP %s (%s bytes)"
                        % (index.get("status"), fetched.get("status"), fetched.get("bytes"))
                    )
                else:
                    print(
                        "self-check  browser half NOT confirmed: GET / -> HTTP %s%s"
                        % (index.get("status"), (": " + str(index.get("error"))[:200]) if index.get("error") else "")
                    )
                print("            %s" % _redact(url))
            except Exception as error:  # noqa: BLE001 - a failed self-check must not end the session
                print("self-check  skipped (%s)" % error)
        sys.stdout.flush()

        while not stop.is_set():
            code = boot.process.poll()
            if code is not None:
                print("\nhost exited on its own (code %s) — see %s" % (code, work_root / "boot.stderr.log"))
                tail = "\n".join((boot.stderr or [])[-15:])
                if tail:
                    print(tail)
                return 1
            stop.wait(0.5)
        print("\nstopping sandbox Host (own process group only)…")
        return 0
    finally:
        boot.stop()
        for signum, handler in previous.items():
            try:
                signal.signal(signum, handler)
            except (ValueError, OSError):
                pass
        print("sandbox kept (logs included): %s" % work_root)


def _redact(url: str) -> str:
    return re.sub(r"token=[^&\s]+", "token=<redacted>", url)


# ── checks ───────────────────────────────────────────────────────────────────


def scan_not_activated(lines: List[str], needle: str) -> List[str]:
    """`dsh: <name> did not activate` header lines (plus their first detail line)."""
    hits: List[str] = []
    in_block = False
    for line in lines:
        if line.startswith("dsh: "):
            in_block = needle in line and "did not activate" in line
            if in_block:
                hits.append(line)
            continue
        if in_block and line and not line.startswith((" ", "\t", "at ")):
            hits.append("  " + line[:220])
            in_block = False
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", default=os.environ.get("DSH_APP", DEFAULT_APP), help="DeepSeek Harness.app")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DSH_VERIFY_PORT", DEFAULT_PORT)))
    parser.add_argument("--timeout", type=float, default=90.0, help="boot budget in seconds")
    parser.add_argument("--no-http", action="store_true", help="skip check D (browser half)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--json", action="store_true", help="emit a machine-readable receipt")
    mode.add_argument(
        "--serve",
        action="store_true",
        help="keep the sandbox Host alive for manual browser testing (Ctrl-C to stop)",
    )
    args = parser.parse_args()

    source_home, source_profile, cli, electron = resolve_paths(args.app)
    loader_url = (
        Path(args.app).expanduser()
        / "Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-typert-loader/lib/index.js"
    )
    stamp = time.strftime("%Y%m%d-%H%M%S")
    work_root = REPO / ".verify" / stamp
    work_root.mkdir(parents=True, exist_ok=True)
    sandbox_home, sandbox_profile = build_sandbox(source_profile, work_root, with_probe=not args.serve)
    credentials = link_credentials(source_home, sandbox_home)
    if args.serve:
        return serve_host(
            electron,
            cli,
            work_root,
            sandbox_home,
            sandbox_profile,
            args.port,
            args.timeout,
            credentials,
            http_check=not args.no_http,
        )
    report: Dict[str, Any] = {
        "sandbox": str(work_root),
        "profile": str(sandbox_profile),
        "port": args.port,
        "patch": PATCH_NOTE,
        "checks": {},
    }

    # A1: composed tree
    code, out, err = run_dump_config(electron, cli, sandbox_home, "verify-boot")
    (work_root / "dump-config.txt").write_text(out + ("\n[stderr]\n" + err if err.strip() else ""))
    rows = [line.strip() for line in out.splitlines() if "selection-translate" in line]
    report["checks"]["A_dump_config"] = {
        "status": "PASS" if code == 0 and rows else "FAIL",
        "exit": code,
        "evidence": rows[:6] or ["(no `selection-translate` row in --dump-config output)"],
        "stderr": err.strip().splitlines()[:6],
    }

    # boot
    boot = Boot(electron, cli, sandbox_home, "verify-boot", args.port, args.timeout)
    try:
        boot.wait_ready(min(args.timeout, 75.0))
        port_up = wait_port(args.port, 20.0)
        http_evidence: Optional[Dict[str, Any]] = None
        web_url = boot.browser_url()
        report["webUrl"] = _redact(web_url) if web_url else None
        if not args.no_http and port_up:
            http_evidence = client_urls(args.port, PACKAGE, web_url)
        elif not args.no_http:
            http_evidence = {"index": {"status": 0, "error": "port %d never opened" % args.port}}
    finally:
        boot.stop()
        (work_root / "boot.stdout.log").write_text("\n".join(boot.stdout) + "\n")
        (work_root / "boot.stderr.log").write_text("\n".join(boot.stderr) + "\n")

    combined = boot.stdout + boot.stderr

    # A2: mounted without a "did not activate" diagnostic
    not_activated = scan_not_activated(boot.stderr, PACKAGE)
    probe_entry = next((line for line in boot.stdout if line.startswith("PROBE_ENTRY ")), None)
    mounted = False
    if probe_entry is not None:
        try:
            entries = json.loads(probe_entry[len("PROBE_ENTRY "):])
        except ValueError:
            entries = []
        mounted = any(entry.get("disabled") is not True and entry.get("state") == 2 for entry in entries)
    report["checks"]["A_mounted"] = {
        "status": "PASS" if (not not_activated and mounted) else "FAIL",
        "evidence": [line for line in [probe_entry] if line] + not_activated,
        "timed_out": boot.timed_out,
    }

    # B: the Service constructor ran (its own logger.info line + the live service key)
    ready_lines = [line for line in combined if READY_MARKER in line]
    probe_service = next((line for line in boot.stdout if line.startswith("PROBE_SERVICE ")), None)
    probe_log = next((line for line in boot.stdout if line.startswith("PROBE_LOG ")), None)
    service_present = False
    if probe_service is not None:
        try:
            service_present = json.loads(probe_service[len("PROBE_SERVICE "):]).get("present") is True
        except ValueError:
            service_present = False
    ready_from_buffer = None
    if probe_log is not None:
        try:
            record = json.loads(probe_log[len("PROBE_LOG "):])
        except ValueError:
            record = None
        if isinstance(record, dict) and isinstance(record.get("line"), str) and READY_MARKER in record["line"]:
            ready_from_buffer = record["line"]
    report["checks"]["B_service"] = {
        "status": "PASS" if (ready_lines or ready_from_buffer) and service_present else "FAIL",
        "evidence": (ready_lines[:2] or ([ready_from_buffer] if ready_from_buffer else []))
        + ([probe_service] if probe_service else []),
    }

    # C: typert artifact accepted
    probe_typert_line = next((line for line in boot.stdout if line.startswith("PROBE_TYPERT ")), None)
    typert_probe: Dict[str, Any] = {}
    if probe_typert_line is not None:
        try:
            typert_probe = json.loads(probe_typert_line[len("PROBE_TYPERT "):])
        except ValueError:
            typert_probe = {}
    # Probe output is our own channel, never a Host diagnostic.
    host_lines = [line for line in combined if not line.startswith("PROBE_")]
    typert_errors = [
        line
        for line in host_lines
        if ("typert" in line.lower() and any(word in line.lower() for word in ("error", "failed", "warn", "cannot", "must")))
        or (PACKAGE in line and "typert" in line.lower())
    ]
    loader_check = run_loader_check(electron, sandbox_profile, work_root, loader_url)
    report["checks"]["C_typert"] = {
        "status": "PASS" if loader_check.get("ok") and not not_activated and typert_probe.get("count", 0) > 0 else "FAIL",
        "evidence": [
            probe_typert_line or "(no PROBE_TYPERT line)",
            json.dumps(loader_check.get("validation", {}))[:400],
            json.dumps(loader_check.get("export", {}))[:300],
        ],
        "registry_count": typert_probe.get("count"),
        "typert_log_errors": typert_errors[:6],
        "loader_check": loader_check,
    }

    # E: the row's settings form is actually editable (the live half of the
    # configuration UI). Reads through `settings.describe()`, writes through the
    # plugin's own `saveSettings()`, reads the write back — plus the duplicate-id
    # count that makes the difference between "a row exists" and "a row is editable".
    probe_settings_line = next((line for line in boot.stdout if line.startswith("PROBE_SETTINGS ")), None)
    settings_probe: Dict[str, Any] = {}
    if probe_settings_line is not None:
        try:
            settings_probe = json.loads(probe_settings_line[len("PROBE_SETTINGS "):])
        except ValueError:
            settings_probe = {}
    report["checks"]["E_settings"] = {
        "status": "PASS" if settings_probe.get("ok") is True else "FAIL",
        "evidence": [
            probe_settings_line or "(no PROBE_SETTINGS line)",
            "fields: %s" % json.dumps(settings_probe.get("fields")),
            "revision: %s -> %s, style: %s -> %s (restored %s)"
            % (
                settings_probe.get("revisionBefore"),
                settings_probe.get("revisionAfter"),
                settings_probe.get("styleBefore"),
                settings_probe.get("styleAfter"),
                settings_probe.get("styleRestored"),
            ),
            "rows with this id: loader=%s configEditor=%s"
            % (settings_probe.get("loaderRowsWithId"), settings_probe.get("configEditorEntries")),
        ],
        "probe": settings_probe,
    }

    # D: browser half served
    if args.no_http:
        report["checks"]["D_client"] = {"status": "UNVERIFIED", "evidence": ["--no-http requested"]}
    else:
        fetched = (http_evidence or {}).get("fetched")
        attempts = (http_evidence or {}).get("attempts") or []
        report["checks"]["D_client"] = {
            "status": "PASS" if fetched else "UNVERIFIED",
            "evidence": [
                "unauthenticated GET / -> %s" % json.dumps((http_evidence or {}).get("unauthenticated", {}))[:160],
                "index: " + json.dumps((http_evidence or {}).get("index", {}))[:300],
                "bundle: " + json.dumps(fetched or attempts[:1] or ["(no candidate URL found in the served document)"])[:400],
            ],
            "http": http_evidence,
        }

    (work_root / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("sandbox   %s" % work_root)
        for name in sorted(report["checks"]):
            check = report["checks"][name]
            print("%-12s %-10s" % (name, check["status"]))
            for line in check["evidence"]:
                if line:
                    print("             | %s" % line)
            for line in check.get("typert_log_errors") or []:
                print("             | warn: %s" % line)

    failures = [name for name, check in report["checks"].items() if check["status"] == "FAIL"]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
