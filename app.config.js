const appJson = require('./app.json');

module.exports = ({ config }) => {
  const expoConfig = { ...config, ...appJson.expo };
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL;

  if (baseUrl) {
    expoConfig.experiments = {
      ...(expoConfig.experiments ?? {}),
      baseUrl,
    };
  }

  return expoConfig;
};
