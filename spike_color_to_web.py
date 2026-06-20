from pybricks.pupdevices import ColorSensor
from pybricks.parameters import Port
from pybricks.tools import wait

color_sensor = ColorSensor(Port.D)  # match the port you tested earlier

while True:
    print(color_sensor.color())
    wait(300)
