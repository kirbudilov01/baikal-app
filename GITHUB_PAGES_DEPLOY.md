# GitHub Pages deploy

Можно публиковать web-версию приложения на GitHub Pages. Это будет вертикальный мобильный макет в браузере: разделы `Главная`, `Карта`, `Сообщить`, `Заявки`, `Профиль` работают внутри одной страницы.

## Локально

```bash
npm run build:web
npx serve dist
```

Открой локальный URL, который покажет `serve`.

## Через GitHub Actions

1. Создать GitHub repository.
2. Запушить этот проект в repository.
3. В GitHub открыть `Settings -> Pages`.
4. В `Build and deployment` выбрать `Deploy from a branch`.
5. Выбрать ветку `gh-pages` и папку `/root`.
6. Запушить в `main` или запустить workflow вручную: `Actions -> Deploy web app to GitHub Pages -> Run workflow`.

После успешного деплоя сайт будет доступен по адресу:

```text
https://<github-username>.github.io/<repo-name>/
```

## Почему нужен `EXPO_PUBLIC_BASE_URL`

GitHub Pages для project site открывает приложение не с корня домена, а из папки репозитория: `/<repo-name>/`. Workflow передает это в Expo:

```text
EXPO_PUBLIC_BASE_URL=/${{ github.event.repository.name }}
```

Так статические файлы `_expo/static/...`, картинки и иконки открываются с правильного пути.

## Ограничения

- Это только frontend/demo web build, не нативная iOS/Android установка.
- Камера, галерея и геолокация в браузере зависят от разрешений и HTTPS.
- Backend endpoints пока не подключены к web build, поэтому данные остаются демо/локальными.
