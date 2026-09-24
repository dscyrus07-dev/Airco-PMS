"""
Management Tool — unified development launcher.

    python main.py

Starts the FastAPI backend (uvicorn) and the React/Vite frontend together.
CTRL+C terminates both cleanly. Cross-platform (Windows / macOS / Linux).
"""

import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

BACKEND_PORT = 8000
FRONTEND_PORT = 3000  # vite --port=3000 (frontend/package.json)


def backend_python() -> str:
    """Prefer the backend venv interpreter; fall back to the current one."""
    candidates = [
        BACKEND_DIR / ".venv" / "Scripts" / "python.exe",  # Windows
        BACKEND_DIR / ".venv" / "bin" / "python",          # macOS / Linux
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def frontend_command() -> list[str]:
    npm = shutil.which("npm") or shutil.which("npm.cmd") or "npm"
    # shell=False keeps signals working; on Windows npm resolves via shutil.which
    return [npm, "run", "dev"]


def _pids_listening_on(port: int) -> set[int]:
    """Return PIDs of processes listening on the given TCP port."""
    pids: set[int] = set()
    if os.name == "nt":
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            # Proto  LocalAddr  ForeignAddr  State  PID
            if len(parts) >= 5 and parts[0].startswith("TCP") and parts[3] == "LISTENING":
                local = parts[1]
                if local.rsplit(":", 1)[-1] == str(port):
                    try:
                        pids.add(int(parts[4]))
                    except ValueError:
                        pass
    else:
        lsof = shutil.which("lsof")
        if lsof:
            out = subprocess.run(
                [lsof, "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
                capture_output=True,
                text=True,
            ).stdout
            pids = {int(p) for p in out.split() if p.isdigit()}
        else:
            # Fallback: parse `ss` (common on modern Linux)
            ss = shutil.which("ss")
            if ss:
                out = subprocess.run(
                    [ss, "-ltnp"], capture_output=True, text=True
                ).stdout
                for line in out.splitlines():
                    if f":{port} " in line or line.rstrip().endswith(f":{port}"):
                        m = re.search(r"pid=(\d+)", line)
                        if m:
                            pids.add(int(m.group(1)))
    # Never kill ourselves or the parent shell
    pids.discard(os.getpid())
    pids.discard(os.getppid())
    return pids


def free_port(port: int) -> None:
    """Kill whatever is listening on `port` so the service can bind cleanly."""
    pids = _pids_listening_on(port)
    if not pids:
        return
    for pid in pids:
        try:
            print(f"[launcher] Port {port} in use by PID {pid} — terminating")
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True
                )
            else:
                os.kill(pid, signal.SIGTERM)
        except Exception as exc:
            print(f"[launcher] WARN: could not kill PID {pid}: {exc}")
    # Wait briefly for the port to actually free up
    for _ in range(20):
        if not _pids_listening_on(port):
            return
        time.sleep(0.25)
    print(f"[launcher] WARN: port {port} is still occupied")


def banner() -> None:
    print(
        """
========================================
 Management Tool
 Development Environment
========================================

Backend:
  http://localhost:{be}

API:
  http://localhost:{be}/api/v1

Swagger:
  http://localhost:{be}/docs

Frontend:
  http://localhost:{fe}

Database:
  Supabase PostgreSQL

========================================
 Press CTRL+C to stop all services.
========================================
""".format(be=BACKEND_PORT, fe=FRONTEND_PORT)
    )


def spawn(cmd: list[str], cwd: Path, name: str) -> subprocess.Popen:
    kwargs = {}
    if os.name == "nt":
        # Give each child its own process group so CTRL+C / taskkill works
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        return subprocess.Popen(cmd, cwd=str(cwd), **kwargs)
    except FileNotFoundError:
        print(f"[launcher] ERROR: could not start {name}: {cmd[0]} not found")
        raise


def terminate(proc: subprocess.Popen, name: str) -> None:
    if proc.poll() is not None:
        return
    print(f"[launcher] Stopping {name}...")
    try:
        if os.name == "nt":
            # taskkill /T kills the process tree (npm → node → vite)
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def main() -> int:
    banner()

    # Clean the required ports first — stale uvicorn/vite orphans from a
    # previous run must not block this one.
    free_port(BACKEND_PORT)
    free_port(FRONTEND_PORT)

    backend = frontend = None
    try:
        backend = spawn(
            [
                backend_python(),
                "-m",
                "uvicorn",
                "app.main:app",
                "--port",
                str(BACKEND_PORT),
                "--reload",
            ],
            BACKEND_DIR,
            "backend",
        )
        time.sleep(1.5)  # let uvicorn bind before the frontend starts
        frontend = spawn(frontend_command(), FRONTEND_DIR, "frontend")

        # Watch children — if either dies, report and shut everything down
        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print(f"[launcher] backend exited with code {backend.returncode}")
                return backend.returncode or 1
            if frontend.poll() is not None:
                print(f"[launcher] frontend exited with code {frontend.returncode}")
                return frontend.returncode or 1
    except KeyboardInterrupt:
        print("\n[launcher] Shutting down...")
        return 0
    finally:
        terminate(frontend, "frontend")
        terminate(backend, "backend")


if __name__ == "__main__":
    sys.exit(main())
