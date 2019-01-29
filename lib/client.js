const rp = require('request-promise');

module.exports = class HxClient {
  constructor(log) {
    this.log = log;
    this.token = '';
  }

  async login (email, password) {
    try {
      const data = await rp({
        method: 'POST',
        uri: 'https://user-field.aylanetworks.com/users/sign_in.json',
        body: {
          user: {
            email: email,
            password: password,
            application: {
              app_id: 'JCI-iOS-Thermostat280-id',
              app_secret: 'JCI-iOS-Thermostat280--II9aj3PKLxAckfmXBIDFWkWxVI'
            }
          }
        },
        json: true
      });
      this.token = data.access_token;
      return this.token;
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async apiRequest (method, path, body = undefined) {
    try {
      return await rp({
        method,
        body,
        uri: `https://ads-field.aylanetworks.com/apiv1${path}`,
        headers: {
          Authorization: 'auth_token ' + this.token,
          'content-type': 'application/json'
        },
        json: true
      });
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async getContent (path) {
    try {
      return await this.apiRequest('GET', path);
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async postContent (path, body) {
    try {
      return await this.apiRequest('POST', path, body);
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async getDevices () {
    try {
      return await this.getContent('/devices.json');
    } catch (error) {
      this.log.error(error);
      return [];
    }
  }

  async getCurrentTemperature (dsn) {
    try {
      const {property} = await this.getContent(`/dsns/${dsn}/properties/IDTmp1`);
      return property.value;
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async getCurrentState (dsn) {
    try {
      const {property} = await this.getContent(`/dsns/${dsn}/properties/Con2ACS`);
      return property.value;
    } catch (error) {
      this.log.error(error);
      return null;
    }
  }

  async getProperties (dsn) {
    const context = {};
    try {
      const properties = await this.getContent(`/dsns/${dsn}/properties.json`);
      let tmp;
      properties.forEach(({property}) => {
        switch (property.name) {
        case 'Con2ACS':
          context.currentstate = property.value;
          break;
        case 'IDTmp1':
          context.indoorTemp = property.value;
          break;
        case 'TmpOvr1':
          // heat cool in hex (72 74 -> 0x48 0x4a -> 0x484a -> 18506 e.g. parseInt((72).toString(16) + (74).toString(16), 16) -> 18506
          tmp = (property.value).toString(16);
          context.heatTo = parseInt(tmp.slice(0, 2), 16);
          context.coolTo = parseInt(tmp.slice(2), 16) || context.heatTo;
          break;
        case 'HtStptMin':
          context.minSetpoint = property.value;
          break;
        case 'ClStptMax':
          context.maxSetpoint = property.value;
          break;
        }
      });
      if (context.currentstate === 1) {
        context.targettemp = context.heatTo;
      } else if (context.currentstate === 2) {
        context.targettemp = context.coolTo;
      } else {
        context.targettemp = context.indoorTemp;
      }
    } catch (error) {
      this.log.error(error);
    }
    return context;
  }

  async getTargetTemperature (dsn) {
    try {
      const {targettemp = 0} = await this.getProperties(dsn);
      return targettemp;
    } catch (error) {
      this.log.error(error);
    }
    return 0;
  }

  async setTargetTemperature (dsn, heatTo, coolTo) {
    const value = parseInt(heatTo.toString(16) + coolTo.toString(16), 16);
    const body = {
      datapoint: {
        value,
        metadata: null
      }
    };
    try {
      const {datapoint} = await this.postContent(`/dsns/${dsn}/properties/TmpOvr1/datapoints.json`, body);
      if (datapoint.value === value) {
        await this.postContent(`/dsns/${dsn}/properties/TmpOvrSt/datapoints.json`, {
          datapoint: {
            value: 1,
            metadata: null
          }
        });
        return value;
      }
    } catch (error) {
      this.log.error(error);
    }
    return null;
  }

  async setTargetState (dsn, value) {
    const body = {
      datapoint: {
        value,
        metadata: null
      }
    };
    try {
      const {datapoint} = await this.postContent(`/dsns/${dsn}/properties/ClStptMax/datapoints.json`, body);
      if (datapoint.value === value) {
        this.log('State updated');
        return true;
      }
    } catch (error) {
      this.log.error(error);
    }
    return false;
  }
};
