# Инструкция Мише: подготовка TestFlight

## Что уже готово

- Репозиторий: `https://github.com/kirbudilov01/baikal-app`
- iOS Bundle ID: `ru.newpeople.baikal`
- Временный backend: `https://baikal.46.17.103.26.sslip.io`
- Админка: `https://baikal.46.17.103.26.sslip.io/admin`
- Backend уже проверен: заявки, фото, подтверждения, баллы, админка и статусы работают.

Секреты, пароли, 2FA-коды, Apple session cookies и `ADMIN_TOKEN` нельзя присылать в чат или коммитить в репозиторий.

## 1. Добавить Кирилла/исполнителя в Apple-команду

Если сборку будет запускать не сам Миша:

1. Открыть `https://appstoreconnect.apple.com/access/users`
2. Нажать `+`
3. Добавить Apple ID человека, который будет запускать EAS build/submit.
4. Дать доступ минимум к приложению и TestFlight/App Manager. Если проще на старте - дать `Admin`, потом сузить права.

## 2. Создать App ID в Apple Developer

Открыть:

```text
https://developer.apple.com/account/resources/identifiers/list
```

Дальше:

1. `+`
2. `App IDs`
3. `App`
4. Description: `Baikal`
5. Bundle ID: `Explicit`
6. Bundle ID value:

```text
ru.newpeople.baikal
```

7. Capabilities на старте можно оставить базовые. Push пока не включаем, если нет задачи с пушами.
8. `Continue` -> `Register`

Если Bundle ID уже занят в другой Apple-команде, нужно либо использовать тот аккаунт, где он занят, либо поменять bundle id в приложении и документах.

## 3. Создать приложение в App Store Connect

Открыть:

```text
https://appstoreconnect.apple.com/apps
```

Дальше:

1. `+`
2. `New App`
3. Platform: `iOS`
4. Name:

```text
Байкал в наших руках
```

5. Primary language: `Russian`
6. Bundle ID: `ru.newpeople.baikal`
7. SKU:

```text
baikal-app
```

8. User Access: если спросит, оставить полный доступ нужным пользователям.
9. `Create`

## 4. Подготовить Expo/EAS на машине, где будет сборка

В терминале:

```bash
cd "/Users/kirill/Documents/БАЙКАЛ ПРИЛОЖЕНИЕ"
npm ci
npx eas-cli login
npx eas-cli whoami
```

`whoami` должен показать Expo-аккаунт. Сейчас на машине Кирилла EAS еще не залогинен.

## 5. Проставить EAS env для TestFlight

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://baikal.46.17.103.26.sslip.io
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_ENABLED --value false
npx eas-cli env:create --environment production --name EXPO_PUBLIC_PRIVACY_URL --value https://baikal.46.17.103.26.sslip.io/privacy
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPPORT_URL --value https://baikal.46.17.103.26.sslip.io/support
npx eas-cli env:create --environment production --name EXPO_PUBLIC_TERMS_URL --value https://baikal.46.17.103.26.sslip.io/terms
```

iOS TestFlight использует Apple Maps через `react-native-maps`, отдельный Google Maps key для iOS сейчас не нужен.

## 6. Подготовить iOS credentials

```bash
npm run credentials:ios
```

Что выбирать:

- Apple team Миши.
- Bundle ID: `ru.newpeople.baikal`.
- EAS может управлять certificate/provisioning profile автоматически.
- Если EAS спросит Apple ID/2FA - вводить самому в терминале/браузере, не пересылать код в чат.

## 7. Проверить проект перед сборкой

```bash
npm run doctor
./node_modules/.bin/tsc --noEmit
```

Если обе команды проходят, можно собирать.

## 8. Собрать и отправить в TestFlight

Вариант одной командой:

```bash
npm run release:ios:testflight
```

Или отдельно:

```bash
npm run build:ios:production
npm run submit:ios:testflight
```

После загрузки App Store Connect обычно обрабатывает билд несколько минут. Когда билд появится:

1. Открыть приложение в App Store Connect.
2. Перейти в `TestFlight`.
3. Добавить internal testers.
4. Разослать приглашения.

## 9. Что проверять на iPhone

- Приложение открывается без краша.
- Главная показывает backend-данные.
- Карта открывается и показывает заявки.
- Можно выбрать точку/геолокацию.
- Можно создать заявку с описанием и фото.
- Заявка появляется в `https://baikal.46.17.103.26.sslip.io/admin`.
- В админке можно пройти статусы:
  - `На модерации`
  - `Передано`
  - `В работе`
  - `Решено`
- В приложении обновляется статус заявки.
- Баллы начисляются.
- Бонусы открываются и списываются.
- Privacy/Support/Terms открываются.

## 10. Где взять admin token

Токен лежит только на сервере. Команду запускать локально, значение не пересылать в чат:

```bash
ssh -i ~/.ssh/hostkey_ed25519 -o IdentitiesOnly=yes root@46.17.103.26 \
  "grep '^ADMIN_TOKEN=' /etc/baikal-backend.env"
```

## Полезные ссылки

- App ID: `https://developer.apple.com/help/account/identifiers/register-an-app-id/`
- App Store Connect: `https://appstoreconnect.apple.com/apps`
- TestFlight: `https://developer.apple.com/testflight/`
- Expo EAS Submit: `https://docs.expo.dev/submit/ios/`
