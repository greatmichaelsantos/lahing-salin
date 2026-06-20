from pybricks.pupdevices import ColorSensor, Motor
from pybricks.parameters import Port, Color
from pybricks.tools import wait
from pybricks.hubs import PrimeHub

hub = PrimeHub()
color_sensor = ColorSensor(Port.D)  # match the port you tested earlier
motor = Motor(Port.C)               # drive motor

DRIVE_SPEED = 300       # deg/s while moving forward
STOP_DURATION_MS = 20000  # how long to wait at a detected station

# Only these colors correspond to a station — anything else (e.g. Color.NONE,
# the floor between tiles) is ignored so the rover keeps driving through it.
VALID_COLORS = {Color.YELLOW, Color.RED, Color.BLUE, Color.GREEN, Color.CYAN, Color.WHITE}

motor.run(DRIVE_SPEED)

while True:
    detected = color_sensor.color()
    if detected in VALID_COLORS:
        motor.stop()
        print(detected)  # web app picks this up and navigates
        wait(STOP_DURATION_MS)  # color detection is implicitly disabled — we're not
                                # reading the sensor again until this wait finishes
        motor.run(DRIVE_SPEED)
    wait(100)
