const appJson = require('./app.json');

module.exports = ({ config }) => {
  const expoConfig = {
    ...config,
    ...appJson.expo,
    plugins: [
      ...(appJson.expo.plugins ?? []),
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: process.env.EXPO_GOOGLE_MAPS_API_KEY_ANDROID || '',
        },
      ],
    ],
  };
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL;

  if (baseUrl) {
    expoConfig.experiments = {
      ...(expoConfig.experiments ?? {}),
      baseUrl,
    };
  }

  return expoConfig;
};
