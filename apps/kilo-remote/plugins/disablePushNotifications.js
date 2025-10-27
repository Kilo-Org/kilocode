// plugins/disablePushNotifications.js
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = (config) => {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });
};
