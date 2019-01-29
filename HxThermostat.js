const rp = require('request-promise');
const inherits = require('util').inherits;

let Accessory, Service, Characteristic, uuid;

class HxThermostat {
  constructor(log, thermostat, api, token, interval, config) {
    Accessory = api.platformAccessory;
    Service = api.hap.Service;
    Characteristic = api.hap.Characteristic;
    uuid = api.hap.uuid;
    inherits(HxThermostat, Accessory);

    this.log = log;
    this.thermostat = thermostat;
    this.token = token;
    this.interval = interval;
    this.displayUnits = {
      'C': 0,
      'F': 1
    }[config.displayUnits || 'F'];

    this.apiRequest = async (method, path, body = undefined) => {
      try {
        return await rp({
          method: method,
          uri: `https://ads-field.aylanetworks.com/apiv1${path}`,
          headers: {
            Authorization: 'auth_token ' + this.token,
            'content-type': 'application/json'
          },
          body: body,
          json: true
        });
      } catch (error) {
        this.log('error: ' + error);
        return null;
      }
    };

    this.getContent = async (path) => {
      try {
        return await this.apiRequest('GET', path);
      } catch (error) {
        this.log('error: ' + error);
        return null;
      }
    };
    this.putContent = async (path, body) => {
      try {
        return await this.apiRequest('PUT', path, body);
      } catch (error) {
        this.log('error: ' + error);
        return null;
      }
    };

    this.dsn = thermostat.dsn;
    this.name = thermostat.product_name;
    this.firmwareRevision = thermostat.sw_version;
    this.model = thermostat.model;
    this.serialNumber = thermostat.hwsig;
    this.online = thermostat.connection_status === 'Online';

    this.indoorTemp = 0;
    this.targettemp = 0;
    this.currentstate = 0;

    this.id = uuid.generate(`hx.${this.model}.${this.dsn}`);
    Accessory.call(this, this.name, this.id);
  }

  getServices() {
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Identify, this.dsn)
      .setCharacteristic(Characteristic.Manufacturer, 'Johnson Controls')
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);

    this.Thermostat = new Service.Thermostat(this.name);

    this.Thermostat.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
        minStep: 1
      })
      .updateValue(this.indoorTemp);

    this.Thermostat.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: this.heatSetpointMin,
        maxValue: this.coolSetpointMax,
        minStep: 1
      })
      .updateValue(this.targettemp)
      .on('set', this.setTargetTemperature.bind(this));

    this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .updateValue(this.currentstate)
      .setProps({
        format: Characteristic.Formats.UINT8,
        maxValue: 3,
        minValue: 0,
        validValues: [0, 1, 2, 3],
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      });
    Characteristic.CurrentHeatingCoolingState.AUTO = 3;

    this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(this.currentstate)
      .on('set', this.setTargetHeatingCoolingState.bind(this))
      .setProps({
        format: Characteristic.Formats.UINT8,
        maxValue: 3,
        minValue: 0,
        validValues: [0, 1, 2, 3],
        perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
      });

    this.Thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .updateValue(this.displayUnits);

    this._updateThermostatValues(); // eslint-disable-line no-underscore-dangle

    return [this.informationService, this.Thermostat];
  }

  async _updateThermostatValues() {
    this.log.debug('updating thermostat values...');
    const properties = await this.getContent(`/dsns/${this.dsn}/properties.json`);
    let tmp;
    properties.forEach(({property}) => {
      switch (property.name) {
      case 'ClStpt1':
        this.coolSetpoint = property.value;
        break;
      case 'ClStptMax':
        this.coolSetpointMax = property.value;
        this.coolSetpointMaxKey = property.key;
        break;
      case 'ClStptMin':
        this.coolSetpointMin = property.value;
        this.coolSetpointMinKey = property.key;
        break;
      case 'FanStg1':
        this.fanSetting = property.value;
        this.fanSettingKey = property.key;
        break;
      case 'HtStpt1':
        this.heatSetpoint = property.value;
        this.heatSetpointKey = property.key;
        break;
      case 'HtStptMax':
        this.heatSetpointMax = property.value;
        this.heatSetpointMaxKey = property.key;
        break;
      case 'HtStptMin':
        this.heatSetpointMin = property.value;
        this.heatSetpointMinKey = property.key;
        break;
      case 'Con2ACS':
        this.currentstate = property.value;
        break;
      case 'Hum1':
        this.humidity = property.value;
        break;
      case 'IDTmp1':
        this.indoorTemp = property.value;
        break;
      case 'ODTmp':
        this.outdoorTemp = property.value;
        break;
      case 'TmpOvr1':
        tmp = (property.value).toString(16);
        this.heatTo = parseInt(tmp.slice(0, 2), 16);
        this.coolTo = parseInt(tmp.slice(2), 16);
        if (this.currentstate === 1) {
          this.targettemp = this.heatTo;
        } else if (this.currentstate === 2) {
          this.targettemp = this.coolTo;
        } else {
          this.targettemp = this.indoorTemp;
        }
        this.tempOverride = property.value; // heat cool in hex (72 74 -> 0x48 0x4a -> 0x484a -> 18506)
        this.tempOverrideKey = property.key; // parseInt((72).toString(16) + (74).toString(16), 16) -> 18506
        break;
      case 'TmpOvrSt':
        this.tempOverrideStatus = property.value;
        this.tempOverrideStatusKey = property.key;
        break;
      case 'UsrMd1':
        this.userMode = property.value; // 0 off, 1 heat, 2 cool, 3 auto
        this.userModeKey = property.key;
        break;
      default:
        break;
      }
    });
    this.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.indoorTemp);
    this.Thermostat.getCharacteristic(Characteristic.TargetTemperature).updateValue(this.targettemp);
    this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentstate);
    this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.currentstate);
    const self = this;
    setTimeout(function () {
      self._updateThermostatValues(); // eslint-disable-line no-underscore-dangle
    }, self.interval);
  }

  async setTargetHeatingCoolingState(value, callback) {
    this.log.debug(`setting state to ${value}`);
    const body = {
      datapoint: {
        value: value,
        metadata: null
      }
    };
    try {
      await this.putContent(`/dsns/${this.dsn}/properties/ClStptMax/datapoints.json`, body);
      this.currentstate = value;
      callback();
      this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentstate);
      this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.currentstate);
    } catch (error) {
      this.log(this.name + " setTargetHeatingCoolingState error - " + error);
      this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentstate);
      this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.currentstate);
      callback();
    }
  }

  async setTargetTemperature(value, callback) {
    this.log.debug(`setting temperature to ${value}`);
    if (this.currentstate === 0) {
      this.log("Can't set new Temperature, Thermostat is off");
      callback();
      return;
    }
    const tryAgain = (error) => {
      if (error !== null) {
        this.log(this.name + ": " + error + " - Trying again");
      }
      const self = this;
      setTimeout(async function () {
        await self.setTargetTemperature(value, callback);
      }, this.interval);
    };

    let heatTo = this.heatTo;
    let coolTo = this.coolTo;

    if (this.currentstate === 1) {
      // heat
      heatTo = value;
    } else if (this.currentstate === 2) {
      // cool
      coolTo = value;
    }

    const val = parseInt(heatTo.toString(16) + coolTo.toString(16), 16);

    const body = {
      datapoint: {
        value: val,
        metadata: null
      }
    };
    try {
      const {datapoint} = await this.putContent(`/dsns/${this.dsn}/properties/TmpOvr1/datapoints.json`, body);
      this.log(`${this.name} targettemp: ${heatTo} - ${coolTo}`);
      this.targettemp = value;
      this.heatTo = heatTo;
      this.coolTo = coolTo;
      this.Thermostat.getCharacteristic(Characteristic.TargetTemperature).updateValue(this.targettemp);
      if (datapoint.value === val) {
        callback();
      } else {
        tryAgain();
      }
    } catch (error) {
      tryAgain(error);
    }
  }
}

module.exports = HxThermostat;
