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
displays accessible local URLs, and handles clean process shutdown.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser

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
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 15.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if is_port_in_use(port, host):
            return True
        time.sleep(0.3)
    return False


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


def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "backend")

    print_banner()

    # 1. Check migrations
    print(f"{YELLOW}[1/3] Checking backend database migrations...{RESET}")
    try:
        subprocess.run(
            [sys.executable, "manage.py", "migrate"],
            cwd=backend_dir,
            check=True,
            capture_output=True,
        )
        print(f"      {GREEN}[OK] Database migrations verified.{RESET}")
    except Exception as exc:
        print(f"      {YELLOW}[!] Migration check finished: {exc}{RESET}")

    # 2. Start Backend Server (Django Channels via Daphne on port 8000)
    print(f"{YELLOW}[2/3] Launching Python Django Channels server on port 8000...{RESET}")
    backend_proc = subprocess.Popen(
        [sys.executable, "manage.py", "runserver", "127.0.0.1:8000"],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # 3. Start Frontend Server (Vite on port 3000)
    print(f"{YELLOW}[3/3] Launching Vite React frontend on port 3000...{RESET}")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=root_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for ports to become active
    backend_ok = wait_for_port(8000, timeout=12.0)
    frontend_ok = wait_for_port(3000, timeout=12.0)

    print_links()

    # Attempt to open browser to frontend
    try:
        webbrowser.open("http://localhost:3000")
    except Exception:
        pass

    def cleanup(signum=None, frame=None):
        print(f"\n{YELLOW}Shutting down AMAPP servers...{RESET}")
        try:
            backend_proc.terminate()
            backend_proc.wait(timeout=3)
        except Exception:
            backend_proc.kill()

        try:
            frontend_proc.terminate()
            frontend_proc.wait(timeout=3)
        except Exception:
            frontend_proc.kill()

        print(f"{GREEN}All servers stopped cleanly. Goodbye!{RESET}")
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        while True:
            if backend_proc.poll() is not None:
                print(f"{YELLOW}[!] Backend server stopped.{RESET}")
                break
            if frontend_proc.poll() is not None:
                print(f"{YELLOW}[!] Frontend server stopped.{RESET}")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
