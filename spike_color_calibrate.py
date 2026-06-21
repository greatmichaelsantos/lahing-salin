from pybricks.pupdevices import ColorSensor
from pybricks.parameters import Port
from pybricks.tools import wait

color_sensor = ColorSensor(Port.D)

while True:
    print(color_sensor.hsv())
    wait(300)
