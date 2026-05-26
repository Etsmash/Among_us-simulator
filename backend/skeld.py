# The Skeld – map data used by the game engine (no visual positions here)

CONNECTIONS = {
    "cafeteria":      ["weapons", "medbay", "upper_engine"],
    "weapons":        ["cafeteria", "navigation", "o2"],
    "navigation":     ["weapons", "shields"],
    "o2":             ["weapons", "admin", "shields"],
    "shields":        ["navigation", "o2", "communications", "admin"],
    "communications": ["shields", "storage"],
    "storage":        ["communications", "admin", "electrical", "lower_engine"],
    "admin":          ["o2", "shields", "storage", "medbay"],
    "electrical":     ["storage", "lower_engine", "security"],
    "lower_engine":   ["electrical", "storage", "reactor"],
    "security":       ["electrical", "reactor", "upper_engine"],
    "reactor":        ["security", "upper_engine", "lower_engine"],
    "upper_engine":   ["reactor", "security", "cafeteria"],
    "medbay":         ["cafeteria", "admin"],
}

ROOM_NAMES = {
    "cafeteria":      "Cafeteria",
    "weapons":        "Weapons",
    "navigation":     "Navigation",
    "o2":             "O2",
    "shields":        "Shields",
    "communications": "Communications",
    "storage":        "Storage",
    "admin":          "Admin",
    "electrical":     "Electrical",
    "lower_engine":   "Lower Engine",
    "security":       "Security",
    "reactor":        "Reactor",
    "upper_engine":   "Upper Engine",
    "medbay":         "MedBay",
}

# Vent networks – impostors can teleport between rooms in the same network
VENT_NETWORKS = [
    ["security", "cafeteria", "medbay"],
    ["reactor", "upper_engine", "electrical"],
    ["lower_engine", "storage", "admin"],
]

VENT_CONNECTIONS = {}
for _network in VENT_NETWORKS:
    for _room in _network:
        VENT_CONNECTIONS[_room] = [r for r in _network if r != _room]

# Tasks available per room
ROOM_TASKS = {
    "cafeteria":      ["fix_wiring", "empty_garbage", "download_data"],
    "weapons":        ["clear_asteroids", "calibrate_distributor", "download_data"],
    "navigation":     ["chart_course", "stabilize_steering", "download_data"],
    "o2":             ["clean_o2_filter", "fix_wiring"],
    "shields":        ["prime_shields"],
    "communications": ["download_data", "fix_wiring"],
    "storage":        ["empty_garbage", "fuel_engines"],
    "admin":          ["swipe_card", "fix_wiring"],
    "electrical":     ["fix_wiring", "calibrate_distributor", "download_data"],
    "lower_engine":   ["align_engine_output", "fuel_engines"],
    "security":       ["fix_wiring"],
    "reactor":        ["start_reactor", "unlock_manifolds"],
    "upper_engine":   ["align_engine_output"],
    "medbay":         ["submit_scan", "inspect_sample"],
}

TASK_INFO = {
    "fix_wiring":           {"name": "Fix Wiring",           "duration": 4,  "type": "short"},
    "empty_garbage":        {"name": "Empty Garbage",         "duration": 4,  "type": "short"},
    "download_data":        {"name": "Download Data",         "duration": 8,  "type": "long"},
    "clear_asteroids":      {"name": "Clear Asteroids",       "duration": 5,  "type": "short"},
    "calibrate_distributor":{"name": "Calibrate Distributor", "duration": 5,  "type": "short"},
    "chart_course":         {"name": "Chart Course",          "duration": 4,  "type": "short"},
    "stabilize_steering":   {"name": "Stabilize Steering",    "duration": 5,  "type": "short"},
    "clean_o2_filter":      {"name": "Clean O2 Filter",       "duration": 4,  "type": "short"},
    "prime_shields":        {"name": "Prime Shields",         "duration": 3,  "type": "short"},
    "swipe_card":           {"name": "Swipe Card",            "duration": 3,  "type": "short"},
    "fuel_engines":         {"name": "Fuel Engines",          "duration": 6,  "type": "long"},
    "align_engine_output":  {"name": "Align Engine Output",   "duration": 4,  "type": "short"},
    "start_reactor":        {"name": "Start Reactor",         "duration": 10, "type": "long"},
    "unlock_manifolds":     {"name": "Unlock Manifolds",      "duration": 5,  "type": "short"},
    "submit_scan":          {"name": "Submit Scan",           "duration": 7,  "type": "short"},
    "inspect_sample":       {"name": "Inspect Sample",        "duration": 8,  "type": "long"},
}

# Sabotages impostors can trigger
SABOTAGES = {
    "lights": {
        "name": "Lights Out",
        "fix_room": "electrical",
        "duration": None,
        "game_over_if_not_fixed": False,
        "fixers_needed": 1,
    },
    "reactor": {
        "name": "Reactor Meltdown",
        "fix_room": "reactor",
        "duration": 40,
        "game_over_if_not_fixed": True,
        "fixers_needed": 2,
    },
    "o2": {
        "name": "O2 Depleted",
        "fix_room": "o2",
        "duration": 30,
        "game_over_if_not_fixed": True,
        "fixers_needed": 1,
    },
    "communications": {
        "name": "Comms Sabotaged",
        "fix_room": "communications",
        "duration": None,
        "game_over_if_not_fixed": False,
        "fixers_needed": 1,
    },
}
