from pybricks.pupdevices import ColorSensor, Motor
from pybricks.parameters import Port, Color
from pybricks.tools import wait
from pybricks.hubs import PrimeHub

hub = PrimeHub()
color_sensor = ColorSensor(Port.D)  # match the port you tested earlier
motor = Motor(Port.C)               # drive motor

DRIVE_SPEED = 300         # deg/s while moving forward
STOP_DURATION_MS = 20000  # how long to wait at a detected station
CLEAR_TILE_MS = 5000      # blind drive after cooldown, to get off the current tile

# Only these colors correspond to a station — anything else (e.g. Color.NONE,
# the floor between tiles) is ignored so the rover keeps driving through it.
VALID_COLORS = {Color.YELLOW, Color.RED, Color.BLUE, Color.GREEN, Color.CYAN, Color.WHITE}

motor.run(DRIVE_SPEED)

while True:
    detected = color_sensor.color()
    if detected in VALID_COLORS:
        # 1. Stop and trigger the website action.
        motor.stop()
        print(detected)  # web app picks this up and navigates

        # 2. 20s cooldown — sensor isn't read at all during this wait.
        wait(STOP_DURATION_MS)

        # 3. Drive forward blind for 5s to physically clear this tile —
        #    detection stays off the whole time, no color_sensor.color() calls.
        motor.run(DRIVE_SPEED)
        wait(CLEAR_TILE_MS)

        # 4. Detection re-enables naturally here, on the next loop iteration.
    wait(100)
