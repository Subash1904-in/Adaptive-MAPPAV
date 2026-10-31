# AMAPP — Adaptive Multi-Agent Path Planning for Autonomous Vehicles

<div align="center">

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11%2B-blue?logo=python)
![Django](https://img.shields.io/badge/Django-5.1-092e20?logo=django)
![Three.js](https://img.shields.io/badge/Three.js-r186-black?logo=three.js)
![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178c6?logo=typescript)

**A high-fidelity, genuine Multi-Agent Reinforcement Learning (MARL) traffic simulation engine pairing a Python/Django Channels 30 Hz physics backend with a 60 FPS Three.js 3D web visualizer.**

[Quickstart](#-quickstart) • [Architecture](#-architecture) • [Features](#-key-features) • [RL Training](#-multi-agent-rl-training) • [API & WebSocket](#-api--websocket-reference) • [Controls](#-controls--hotkeys)

</div>

---

## 🚀 Quickstart

AMAPP features an intelligent, self-healing startup script that checks dependencies, frees occupied ports, runs database migrations, and launches both backend and frontend servers with one command.

### 1. Prerequisites
- **Python**: 3.11 or higher
- **Node.js**: 18.0 or higher (with `npm`)

### 2. Launch Everything (Recommended)

Clone the repository and run the quick launcher from the root directory:

```bash
python start.py
```

`start.py` automatically:
1. Verifies and configures Python user site-packages and backend dependencies.
2. Performs pre-flight checks on TCP ports `8000` and `3000` (auto-clearing any stale zombie processes).
3. Applies backend SQLite database migrations.
4. Starts the **Django Channels (Daphne)** ASGI server on `http://localhost:8000`.
5. Starts the **Vite React** frontend development server on `http://localhost:3000`.
6. Launches your default web browser to `http://localhost:3000`.

---

### Manual Launch (Alternative)

If you prefer running services in separate terminal windows:

#### Backend (Django Channels + Daphne)
```bash
cd backend
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000 --noreload
```

#### Frontend (Vite + React + Three.js)
```bash
npm install
npm run dev
```

---

## 🏛 Architecture

AMAPP uses **Centralized Training with Decentralized Execution (CTDE)** to simulate autonomous vehicle fleets, dynamic incident rerouting, cooperative platooning, and pedestrian safety.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Three.js WebGL Frontend (60 FPS)                     │
│  - 3D Procedural City (Roads, Buildings, Sidewalks, Crosswalks)         │
│  - Dynamic Vehicle Meshes, Pure Pursuit Kinematics & Wheel Rotation     │
│  - Interactive V2V Mesh Overlays & Projected 3D Communication Popups    │
│  - Minimal HUD, Telemetry Charts, Scenarios & Incident Injectors        │
└────────────────────────────────────▲────────────────────────────────────┘
                                     │  WebSocket (30 Hz State Stream)
                                     │  HTTP REST (Scenarios / Incidents)
┌────────────────────────────────────▼────────────────────────────────────┐
│                  Django Channels ASGI Backend (Daphne)                  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Multi-Agent Traffic Engine                     │  │
│  │  - Kinematic Bicycle Model (Lookahead pure pursuit, centripetal)  │  │
│  │  - Intelligent Driver Model (IDM) car-following dynamics          │  │
│  │  - Autonomous Intersection Management (AIM Space-Time Slots)      │  │
│  │  - 5.9 GHz DSRC / C-V2X V2V & V2I Communication Mesh              │  │
│  │  - Multi-Agent PPO (MAPPO) Policy Inference (Actor-Critic)        │  │
│  │  - Dynamic A* Pathfinding with incident avoidance cost fields     │  │
│  │  - Sidewalk pedestrian corridors & zebra-crossing safety shields  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 1. Genuine Multi-Agent Reinforcement Learning (MAPPO)
- Powered by decentralized Actor-Critic neural policies.
- Trained across 5 progressive curriculum stages:
  - **Stage A**: Basic driving (acceleration, cruising, IDM car following).
  - **Stage B**: Dynamic route selection and A* congestion rerouting.
  - **Stage C**: Autonomous intersection space-time slot reservation (AIM).
  - **Stage D**: Emergency priority corridors & cooperative civilian yielding.
  - **Stage E**: Mixed rush-hour traffic, bottlenecks, and pedestrian interactions.

### 2. Autonomous Intersection Management (AIM)
- **Zero static traffic lights**: Vehicles cooperatively schedule space-time entry slots through intersections.
- Interconnected V2I reservation eliminates stop-and-go delays while maintaining strict non-overlapping collision safety zones.

### 3. Kinematic Bicycle Model Physics
- Smooth vehicle motion with realistic steering angles, wheelbases, and slip-free pure-pursuit path tracking.
- Centripetal acceleration limits dynamically slow vehicles entering tight corners and intersections.
- Physics-based body roll and pitch during hard acceleration and emergency braking.

### 4. Production-Ready V2V / C-V2X Communication Mesh
- Realistic 5.9 GHz DSRC broadcast simulation with range falloff, transmission latency, and packet loss modeling.
- Automatic cooperative headway negotiation for aerodynamic platooning.
- **3D Overhead V2V Popups**: Real-time holographic communication dialogs rendered directly above vehicles in 3D space.

### 5. Pedestrian Simulation & Crosswalk Safety
- Pedestrians navigate dedicated sidewalk corridors.
- At crosswalks, pedestrians pause at the curb, detect oncoming vehicular traffic, and only cross when a safe gap exists.
- Autonomous vehicles scan crosswalk reservation zones and brake smoothly to yield right-of-way.

### 6. Interactive Scenarios & Incident Injection
Built-in scenario catalogue:
- 🚓 **Police Pursuit**: High-speed pursuit with multi-agent interceptor cordons.
- 🚒 **Fire Rescue**: Multi-station emergency vehicles establishing green-wave corridors.
- 🏛 **VIP Motorcade**: Tight armored escort convoy maintaining rigid protective formations.
- 🚗 **Rush Hour**: High-density multi-lane highway merge and gridlock recovery.
- 🚧 **Bottleneck / Roadblock**: Dynamic lane closures forcing multi-agent A* rerouting.

---

## 🎮 Controls & Hotkeys

| Key / Action | Description |
| :--- | :--- |
| **`B`** | Cycle V2V Popup Display Mode: `Selected Only` *(default)* $\rightarrow$ `All Vehicles` $\rightarrow$ `Off` |
| **`1`** | **Orbit Camera**: Freely rotate, pan, and zoom around the city |
| **`2`** | **Chase Camera**: Third-person tracking camera behind the selected vehicle |
| **`3`** | **Top-Down Camera**: Orthographic tactical traffic monitoring view |
| **`4`** | **Cinematic Camera**: Dynamic sweeping angles across key intersections |
| **`Space`** | Pause / Resume simulation |
| **`R`** | Reset simulation scenario to default |
| **Left Click** | Select a vehicle to inspect live telemetry, V2V logs, and route path |
| **Right Drag** | Rotate 3D camera view |
| **Scroll Wheel** | Zoom in / out |

---

## 🧠 Multi-Agent RL Training

AMAPP includes a headless Gymnasium-compatible training pipeline supporting CPU and GPU (CUDA/MPS) acceleration.

### Run Multi-Agent Training

Train policies across any curriculum stage using Django management commands:

```bash
# Smoke test (verifies observation spaces, action spaces, and forward passes)
python backend/manage.py train_rl --smoke-test

# Train Stage A (Basic Driving & IDM) for 100 episodes
python backend/manage.py train_rl --stage A --episodes 100

# Train Stage D (Emergency Corridors) with custom seed and batch size
python backend/manage.py train_rl --stage D --episodes 250 --batch-size 64 --seed 42

# Train full curriculum Stage E (Mixed Rush-Hour Traffic)
python backend/manage.py train_rl --stage E --episodes 500
```

Checkpoints are automatically registered in `backend/simulation/ai/checkpoints/` and can be loaded dynamically into the live simulation engine.

---

## 📡 API & WebSocket Reference

### HTTP REST Endpoints (Port 8000)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/city/` | Returns static graph topology (nodes, roads, coordinates). |
| `GET` | `/api/scenarios/` | Lists all 8 pre-configured traffic scenarios. |
| `POST` | `/api/sim/<session_id>/scenario/` | Switches the active scenario (e.g. `{"scenario_id": "fire_rescue"}`). |
| `POST` | `/api/sim/<session_id>/incidents/` | Injects an incident (accident, roadblock, debris). |
| `DELETE`| `/api/sim/<session_id>/incidents/<id>/` | Clears an active incident. |
| `POST` | `/api/sim/<session_id>/controller-mode/` | Sets vehicle controller: `ai`, `fallback`, or `evaluation`. |
| `GET` | `/api/sim/<session_id>/ai/status/` | Returns policy metadata, checkpoints, and safety interventions. |
| `GET` | `/api/sim/<session_id>/export/` | Exports structured simulation telemetry logs (JSON). |
| `GET` | `/api/sim/<session_id>/benchmark/` | Runs a multi-agent throughput benchmark. |

### Real-Time WebSocket Stream

Connect your client to the real-time simulation stream:
```
ws://localhost:8000/ws/sim/default/
```

- **Frequency**: 30 Hz
- **Packet Structure**:
```json
{
  "type": "state",
  "data": {
    "tick": 1420,
    "timestamp": 47.33,
    "vehicles": [
      {
        "id": "v_01",
        "type": "ambulance",
        "x": 42.5,
        "y": 0.0,
        "z": -12.3,
        "speed": 14.2,
        "target_speed": 18.0,
        "heading": 1.57,
        "steering_angle": 0.04,
        "acceleration": 1.2,
        "braking": false,
        "path": [[42.5, -12.3], [42.5, 50.0]],
        "v2v_bubble": {
          "text": "EMERGENCY: CLEAR CORRIDOR",
          "intent": "emergency_corridor",
          "priority": 1,
          "target_vehicle_id": null
        }
      }
    ],
    "pedestrians": [ ... ],
    "v2v_mesh": [ ... ],
    "metrics": {
      "avg_speed": 11.4,
      "throughput": 48.2,
      "active_vehicles": 35,
      "collision_preventions": 3
    }
  }
}
```

---

## 📂 Project Structure

```
Adaptive-MAPPAV/
├── backend/                        # Django Channels ASGI Backend
│   ├── backend/                    # ASGI/WSGI settings & routing
│   │   ├── asgi.py                 # ASGI ProtocolTypeRouter (HTTP + Channels WS)
│   │   ├── settings.py             # Channels, CORS, DRF configuration
│   │   └── urls.py                 # API URL routing
│   ├── simulation/                 # Multi-Agent Simulation Engine
│   │   ├── ai/                     # MAPPO Reinforcement Learning Subsystem
│   │   │   ├── actions.py          # Continuous & discrete action schemas
│   │   │   ├── environment.py      # Gymnasium MultiAgentTrafficEnv
│   │   │   ├── mappo.py            # MAPPO Actor-Critic neural network
│   │   │   ├── policy.py           # Decentralized vehicle policy execution
│   │   │   ├── registry.py         # Model checkpoint manager
│   │   │   ├── reward.py           # Multi-objective reward calculator
│   │   │   ├── safety_shield.py    # Deterministic safety verification
│   │   │   └── curriculum.py       # 5-stage progressive training curriculum
│   │   ├── city_map.py             # Road network graph & spatial indexing
│   │   ├── consumers.py            # Channels 30 Hz WebSocket consumer
│   │   ├── engine.py               # 30 Hz physics, IDM, kinematics & state loop
│   │   ├── management/commands/    # CLI utilities (train_rl)
│   │   ├── pathfinding.py          # Dynamic A* multi-path planner
│   │   ├── pedestrians.py          # Sidewalk & crosswalk simulation
│   │   ├── scenarios.py            # Built-in traffic scenarios
│   │   ├── v2v.py                  # DSRC / C-V2X communication mesh
│   │   └── views.py                # REST API endpoints
│   ├── manage.py                   # Django CLI entrypoint
│   └── requirements.txt            # Python dependencies
│
├── src/                            # React 19 + Three.js Frontend
│   ├── components/                 # UI Overlays & 3D HUDs
│   │   ├── Canvas3D.tsx            # Three.js WebGL scene & lighting
│   │   ├── CityRenderer.tsx        # Roads, sidewalks, crosswalks & buildings
│   │   ├── VehicleRenderer.tsx     # Vehicle 3D meshes & wheel animation
│   │   ├── V2VOverlay.tsx          # 3D holographic V2V overhead popups
│   │   ├── MinimalHUD.tsx          # Telemetry, speed & throughput cards
│   │   ├── ControlOverlay.tsx      # Scenario & rule preset controllers
│   │   └── LiveBackendBridge.tsx   # Live Channels WebSocket connector
│   ├── simulation/                 # Client-side kinematics & prediction
│   └── App.tsx                     # Main application layout
│
├── logs/                           # Runtime diagnostics & crash logs
├── start.py                        # Quick-launch & port self-healing runner
├── package.json                    # Node.js dependencies & scripts
├── vite.config.ts                  # Vite build configuration
└── README.md                       # Project documentation
```

---

## 🧪 Testing

Run backend unit and integration tests:

```bash
# Run all 20 backend unit tests
python backend/manage.py test simulation

# Run RL environment smoke test
python backend/manage.py train_rl --smoke-test

# Verify frontend production build
npm run build
```

---

## 📄 License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.
