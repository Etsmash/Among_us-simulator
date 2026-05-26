import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO

from backend.game import Game

app = Flask(__name__)
app.config["SECRET_KEY"] = "among-us-sim-secret"
socketio = SocketIO(app, async_mode="eventlet", cors_allowed_origins="*")

game = Game(socketio)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/start", methods=["POST"])
def start_game():
    data           = request.get_json(silent=True) or {}
    num_players    = int(data.get("num_players", 10))
    num_impostors  = int(data.get("num_impostors", 2))
    speed_map      = {"slow": 2.5, "normal": 1.5, "fast": 0.7}
    tick_speed     = speed_map.get(data.get("speed", "normal"), 1.5)

    game.configure(num_players, num_impostors, tick_speed)
    game.start()
    return jsonify({"status": "started"})


@app.route("/api/stop", methods=["POST"])
def stop_game():
    game.stop()
    return jsonify({"status": "stopped"})


@socketio.on("connect")
def on_connect():
    socketio.emit("game_state", game.get_state(), to=request.sid)


@socketio.on("request_state")
def on_request_state():
    socketio.emit("game_state", game.get_state(), to=request.sid)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
