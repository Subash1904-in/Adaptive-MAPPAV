#!/usr/bin/env python3
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
AMAPP Quick-Launch Startup Script
Starts the Django Channels backend (Port 8000) and Vite React frontend (Port 3000),
displays accessible local URLs, diagnoses runtime issues, and handles clean process shutdown.
"""

from __future__ import annotations

import os
import signal
import site
import socket
import subprocess
import sys
import time
import webbrowser

try:
    import psutil
except ImportError:
    psutil = None

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Terminal ANSI color helpers
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Checks whether the specified TCP port is currently occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def free_port(port: int) -> bool:
    """Finds and terminates any lingering zombie process holding the port."""
    if not is_port_in_use(port):
        return True

    freed = False
    if psutil:
        try:
            for conn in psutil.net_connections(kind="inet"):
                if conn.laddr.port == port and conn.status == psutil.CONN_LISTEN and conn.pid:
                    try:
                        p = psutil.Process(conn.pid)
                        print(f"      {YELLOW}[!] Port {port} was held by stale PID {conn.pid} ({p.name()}). Freeing...{RESET}")
                        for child in p.children(recursive=True):
                            try:
                                child.kill()
                            except Exception:
                                pass
                        p.kill()
                        freed = True
                    except Exception:
                        pass
        except Exception:
            pass

    # Fallback for Windows using taskkill if psutil wasn't sufficient
    if sys.platform == "win32" and is_port_in_use(port):
        try:
            cmd = f'netstat -ano | findstr :{port}'
            output = subprocess.check_output(cmd, shell=True, text=True, errors="replace")
            for line in output.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) != os.getpid():
                        subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
                        freed = True
        except Exception:
            pass

    # Wait briefly for OS socket cleanup
    for _ in range(10):
        if not is_port_in_use(port):
            return True
        time.sleep(0.3)

    return not is_port_in_use(port)


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 15.0) -> bool:
    """Polls until a port is open and listening or until timeout expires."""
    start = time.time()
    while time.time() - start < timeout:
        if is_port_in_use(port, host):
            return True
        time.sleep(0.3)
    return False


def kill_process_tree(proc: subprocess.Popen | None):
    """Cleanly terminates a process and all its child/grandchild processes."""
    if proc is None:
        return
    try:
        if psutil:
            parent = psutil.Process(proc.pid)
            children = parent.children(recursive=True)
            for child in children:
                try:
                    child.kill()
                except Exception:
                    pass
            parent.kill()
        elif sys.platform == "win32":
            subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True)
        else:
            proc.terminate()
            proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def print_banner():
    banner = f"""
{CYAN}{BOLD}========================================================================{RESET}
{CYAN}{BOLD}     ___    __  ______    ____  ____     ___ _    __  {RESET}
{CYAN}{BOLD}    /   |  /  |/  /   |  / __ \\/ __ \\   /   | |  / /  {RESET}
{CYAN}{BOLD}   / /| | / /|_/ / /| | / /_/ / /_/ /  / /| | | / /   {RESET}
{CYAN}{BOLD}  / ___ |/ /  / / ___ |/ ____/ ____/  / ___ | |/ /    {RESET}
{CYAN}{BOLD} /_/  |_/_/  /_/_/  |_/_/   /_/      /_/  |_|___/     {RESET}
{DIM} Adaptive Multi-Agent Pathfinding & Priority with Django + Three.js{RESET}
{CYAN}{BOLD}========================================================================{RESET}
"""
    print(banner)


def print_links():
    box = f"""
{GREEN}{BOLD}>>> SYSTEM ACTIVE & RUNNING <<<{RESET}

Access the simulation and APIs using the following localhost links:

  {BOLD}[UI]  3D Interactive Frontend:{RESET}  {CYAN}{BOLD}http://localhost:3000{RESET}
        {DIM}(Three.js City Visualizer, Controls, Metrics HUD, V2V Mesh){RESET}

  {BOLD}[API] Django REST API Root:{RESET}     {CYAN}{BOLD}http://localhost:8000/api/{RESET}
  {BOLD}[MAP] City Graph Topology:{RESET}      {CYAN}{BOLD}http://localhost:8000/api/city/{RESET}
  {BOLD}[SCN] Scenarios Catalogue:{RESET}      {CYAN}{BOLD}http://localhost:8000/api/scenarios/{RESET}
  {BOLD}[WSS] Real-Time WebSocket:{RESET}      {CYAN}{BOLD}ws://localhost:8000/ws/sim/default/{RESET}
  {BOLD}[ADM] Django Admin Portal:{RESET}      {CYAN}{BOLD}http://localhost:8000/admin/{RESET}

{DIM}Press Ctrl+C at any time in this window to stop both servers.{RESET}
{CYAN}------------------------------------------------------------------------{RESET}
"""
    print(box)


def print_recent_logs(log_path: str, title: str):
    """Outputs recent lines of a log file to the terminal for debugging."""
    if not os.path.exists(log_path):
        return
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        recent = lines[-20:] if len(lines) > 20 else lines
        if recent:
            print(f"\n{RED}{BOLD}--- Recent {title} Log Output ---{RESET}")
            for line in recent:
                sys.stdout.write(f"  {DIM}{line}{RESET}")
            print(f"{RED}{BOLD}----------------------------------{RESET}\n")
    except Exception:
        pass


def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "backend")
    logs_dir = os.path.join(root_dir, "logs")
    os.makedirs(logs_dir, exist_ok=True)

    backend_log_path = os.path.join(logs_dir, "backend.log")
    frontend_log_path = os.path.join(logs_dir, "frontend.log")

    print_banner()

    # Pre-flight: Check and clear lingering ports
    print(f"{YELLOW}[*] Performing pre-flight socket port verification...{RESET}")
    free_port(8000)
    free_port(3000)

    # Pre-flight: Configure Python environment & verify dependencies
    env = os.environ.copy()
    py_paths = [backend_dir]
    user_site = site.getusersitepackages()
    if user_site and os.path.exists(user_site):
        py_paths.append(user_site)
    appdata = os.environ.get("APPDATA")
    if appdata:
        py_ver_tag = f"Python{sys.version_info.major}{sys.version_info.minor}"
        sp = os.path.join(appdata, "Python", py_ver_tag, "site-packages")
        if os.path.exists(sp) and sp not in py_paths:
            py_paths.append(sp)
    if "PYTHONPATH" in env:
        py_paths.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(py_paths)

    for p in py_paths:
        if p not in sys.path:
            sys.path.insert(0, p)

    try:
        import django
    except ImportError:
        print(f"{YELLOW}[*] Django not found in {sys.executable}. Installing backend dependencies...{RESET}")
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", os.path.join(backend_dir, "requirements.txt")],
                cwd=root_dir,
                check=True,
            )
            print(f"      {GREEN}[OK] Backend dependencies installed successfully.{RESET}")
        except Exception as exc:
            print(f"{RED}[!] Failed to install dependencies: {exc}{RESET}")

    # 1. Check database migrations
    print(f"{YELLOW}[1/3] Checking backend database migrations...{RESET}")
    try:
        subprocess.run(
            [sys.executable, "manage.py", "migrate"],
            cwd=backend_dir,
            env=env,
            check=True,
            capture_output=True,
        )
        print(f"      {GREEN}[OK] Database migrations verified.{RESET}")
    except Exception as exc:
        print(f"      {YELLOW}[!] Migration check finished: {exc}{RESET}")

    # 2. Start Backend Server (Django Channels via Daphne on port 8000)
    # Using --noreload is required for reliable Windows Daphne execution (avoids StatReloader deadlocks)
    print(f"{YELLOW}[2/3] Launching Python Django Channels server on port 8000...{RESET}")
    backend_log_file = open(backend_log_path, "w", encoding="utf-8", errors="replace")
    backend_proc = subprocess.Popen(
        [sys.executable, "-u", "manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
        cwd=backend_dir,
        env=env,
        stdout=backend_log_file,
        stderr=subprocess.STDOUT,
    )

    # 3. Start Frontend Server (Vite on port 3000)
    print(f"{YELLOW}[3/3] Launching Vite React frontend on port 3000...{RESET}")
    frontend_log_file = open(frontend_log_path, "w", encoding="utf-8", errors="replace")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=root_dir,
        stdout=frontend_log_file,
        stderr=subprocess.STDOUT,
    )

    # Wait for ports to become active
    backend_ok = wait_for_port(8000, timeout=12.0)
    frontend_ok = wait_for_port(3000, timeout=12.0)

    if not backend_ok:
        print(f"{RED}[!] Backend server did not bind to port 8000 within timeout.{RESET}")
        print_recent_logs(backend_log_path, "Backend")

    if not frontend_ok:
        print(f"{YELLOW}[!] Frontend server did not bind to port 3000 within timeout.{RESET}")
        print_recent_logs(frontend_log_path, "Frontend")

    if backend_ok and frontend_ok:
        print_links()
        try:
            webbrowser.open("http://localhost:3000")
        except Exception:
            pass

    def cleanup(signum=None, frame=None):
        print(f"\n{YELLOW}Shutting down AMAPP servers...{RESET}")
        kill_process_tree(backend_proc)
        kill_process_tree(frontend_proc)
        try:
            backend_log_file.close()
        except Exception:
            pass
        try:
            frontend_log_file.close()
        except Exception:
            pass
        free_port(8000)
        free_port(3000)
        print(f"{GREEN}All servers stopped cleanly. Goodbye!{RESET}")
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        while True:
            if backend_proc.poll() is not None:
                print(f"\n{RED}[!] Backend server stopped unexpectedly (exit code {backend_proc.returncode}).{RESET}")
                print_recent_logs(backend_log_path, "Backend")
                break
            if frontend_proc.poll() is not None:
                print(f"\n{RED}[!] Frontend server stopped unexpectedly (exit code {frontend_proc.returncode}).{RESET}")
                print_recent_logs(frontend_log_path, "Frontend")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
