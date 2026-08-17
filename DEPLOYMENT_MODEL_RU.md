# Как будет работать деплой приложения

## Нужно ли нам иметь сервер перед App Store?

Да, если приложение должно реально принимать жалобы, хранить статусы, показывать админку и начислять баллы.

App Store хранит и распространяет только iOS-приложение. Он не хранит наши заявки, фото, статусы и админку. Поэтому нужны две независимые части:

1. **iOS-приложение** - загружается в App Store Connect/TestFlight через EAS.
2. **Backend-сервер** - работает отдельно, принимает API-запросы от приложения и админки.

## Что сейчас есть

Backend уже умеет:

- `GET /health` - проверка живости сервера.
- `GET /api/reports` - список заявок для приложения.
- `POST /api/reports` - создать заявку.
- `GET /api/statuses` - справочник статусов.
- `GET /api/admin/reports` - очередь админки.
- `GET /api/admin/reports/:id` - детали заявки.
- `POST /api/admin/reports/:id/status` - сменить статус.
- `GET /admin` - web-админка.

Админка защищена `ADMIN_TOKEN`.

## Временный демонстрационный сервер

Да, можно поднять временный сервер на Render.

Это нормальный путь для:

- внутреннего TestFlight;
- демонстрации другу-разработчику;
- проверки заявки -> backend -> админка -> статус;
- первых ручных тестов.

Ограничения временного сервера:

- текущая база - JSON-файл, не production database;
- фото пока не хранятся в object storage;
- на бесплатном/дешевом тарифе возможны sleep/restart;
- для публичного App Store лучше Postgres + object storage + мониторинг.

## Как приложение поймет, куда отправлять заявки

Перед сборкой iOS задаем EAS env:

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://YOUR_BACKEND_URL
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_ENABLED --value false
npx eas-cli env:create --environment production --name EXPO_PUBLIC_PRIVACY_URL --value https://YOUR_PRIVACY_URL
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPPORT_URL --value https://YOUR_SUPPORT_URL
```

Для внутренней админ-сборки можно включить:

```bash
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_ADMIN_ENABLED --value true
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_ADMIN_TOKEN --value YOUR_ADMIN_TOKEN
```

Но публичную App Store сборку так делать нельзя: публичный токен в клиенте не является настоящей защитой.

## Как поднять backend на Render

В repo уже есть `render.yaml`.

1. Убедиться, что `render.yaml` запушен в GitHub.
2. Открыть Blueprint:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kirbudilov01/baikal-app
```

3. В Render заполнить env:

```text
ADMIN_TOKEN=сгенерированный_секрет
ALLOWED_ORIGINS=https://kirbudilov01.github.io,https://YOUR_DOMAIN
MAX_BODY_BYTES=1000000
NODE_ENV=production
ALLOW_UNSAFE_LOCAL_ADMIN=false
```

4. Нажать Apply.
5. Проверить:

```bash
curl https://YOUR_BACKEND_URL/health
```

6. Открыть:

```text
https://YOUR_BACKEND_URL/admin
```

7. Ввести `ADMIN_TOKEN`.

## Можно ли потом переехать на другой сервер?

Да. Если API остается совместимым, мобильному приложению нужно только поменять:

```text
EXPO_PUBLIC_API_BASE_URL
```

После смены backend URL нужно сделать новую сборку или EAS Update, если изменение попадает в JS bundle и политика обновлений разрешает.

## Что нужно перед публичным App Store

Минимально:

- Production backend URL.
- Privacy Policy URL.
- Support URL.
- Рабочая админка.
- Фото загружаются не как локальный URI, а в storage.
- База не JSON-файл, а durable DB.
- Админка не зависит от публичного токена в приложении.
- Проверка на реальном iPhone.

## Завтрашняя цель

Реалистичная цель на завтра:

1. Поднять Render backend.
2. Подключить iOS app к backend через EAS env.
3. Собрать production iOS build.
4. Отправить в internal TestFlight.
5. Проверить на iPhone:
   - создание заявки;
   - появление в `/admin`;
   - смена статуса;
   - обновление статуса в приложении;
   - бонусы/листики;
   - privacy/support ссылки.
