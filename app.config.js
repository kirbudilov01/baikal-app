const appJson = require('./app.json');

module.exports = () => {
  const config = { ...appJson.expo };
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL;

  if (baseUrl) {
    config.experiments = {
      ...(config.experiments ?? {}),
      baseUrl,
    };
  }

  return config;
};
