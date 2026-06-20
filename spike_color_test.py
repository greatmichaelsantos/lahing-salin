from pybricks.pupdevices import ColorSensor, Motor
from pybricks.parameters import Port
from pybricks.tools import wait

color_sensor = ColorSensor(Port.D)
motor = Motor(Port.C)

# Spin the motor briefly to confirm it's wired and responding.
motor.run_time(500, 2000)

while True:
    detected = color_sensor.color()
    print(detected)
    wait(500)
