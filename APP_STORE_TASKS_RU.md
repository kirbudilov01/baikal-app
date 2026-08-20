# Статус и список задач до App Store

Дата: 2026-08-17

## Короткий статус

Приложение не готово к полноценной публикации в App Store как production-продукт.

Приложение можно готовить к внутреннему TestFlight, чтобы завтра поставить на iPhone, пройти основные сценарии и показать разработчику/команде.

## Что уже есть

- Expo SDK 57.
- iOS bundle id: `ru.baikal.vrukah`.
- Команды EAS build/submit.
- `expo-doctor` release gate.
- Главный mobile shell.
- Создание заявки.
- Локальный draft заявки.
- Фото через камеру/галерею.
- Выбор места на прототипной карте.
- Список заявок.
- Статусы заявок.
- Баллы/листики.
- Бонусы.
- Backend API для заявок.
- Backend status machine.
- Admin API.
- Отдельная web-админка backend: `/admin`.
- Admin UI, скрываемый через `EXPO_PUBLIC_ADMIN_ENABLED=true`.
- Минимальная защита `/api/admin/*` через `ADMIN_TOKEN`.
- CORS allowlist.
- Request body size limit.
- Render blueprint для backend.
- Privacy/support placeholders.
- App Store readiness docs.
- Admin tab скрыт по умолчанию и включается только через `EXPO_PUBLIC_ADMIN_ENABLED=true`.
- Production API URL задается через `EXPO_PUBLIC_API_BASE_URL`.

## Что не готово для App Store Review

### P0: нельзя идти в публичный App Store без этого

1. Apple Developer аккаунт и App Store Connect app.
2. Expo login и EAS credentials.
3. Production backend deployed.
4. `EXPO_PUBLIC_API_BASE_URL` указывает на production backend.
5. `ADMIN_TOKEN` настроен на backend.
6. `ALLOWED_ORIGINS` настроен на production web/app origins.
7. Публичная Privacy Policy URL.
8. Публичная Support URL.
9. Privacy Policy доступна внутри приложения.
10. Support доступен внутри приложения.
11. App Store Privacy Nutrition Label заполнен по реальному сбору данных.
12. Admin UI не виден обычному пользователю. Кодовая защита добавлена, нужно проверить production build.
13. Админка работает с токеном. Backend-защита добавлена, нужно настроить реальные env.
14. Все заявки из приложения реально доходят в backend.
15. Статусы из админки меняют состояние заявки.
16. Фото не должны храниться как локальный URI. Нужно object storage или временно отключить обязательность фото для production.
17. Карта должна быть либо настоящей картой, либо честно помеченным TestFlight-прототипом. Для App Store лучше настоящая карта.
18. Нельзя обещать, что “службы решат”, если нет реального процесса передачи.
19. Нужно убрать/смягчить любые формулировки, похожие на официальный государственный канал, если нет юридического основания.
20. Нужно пройти smoke test на реальном iPhone.
21. Нужно снять App Store screenshots с production-equivalent сборки.
22. Нужно подготовить Review Notes.
23. Нужно проверить, что приложение не падает без backend.
24. Нужно проверить, что приложение не падает при отказе в камере/геолокации/галерее.
25. Нужно проверить, что ошибки backend показываются человеку понятным языком.

### P1: сильно желательно до внешнего TestFlight

1. Реальный auth для пользователей или хотя бы anonymous device id.
2. Улучшить отдельную web admin panel: поиск, фильтры, фото, экспорт.
3. RBAC для админов.
4. Admin login вместо shared token.
5. Postgres вместо JSON файла.
6. Object storage для фото.
7. Rate limiting.
8. Audit log без перезаписи.
9. Monitoring/alerts.
10. Backups.
11. Data deletion request flow.
12. Export/forwarding заявки ответственным службам.
13. Комментарий администратора при отклонении.
14. Duplicate merge flow.
15. Push notifications по статусам.
16. Redemption flow для бонусов.
17. История начисления листиков.
18. Server-side calculation of points.
19. Ограничение подозрительных/спам заявок.
20. Terms/Community rules page.

### P2: после первой беты

1. Настоящая дизайн-система.
2. Figma handoff.
3. Более дорогой визуал карты.
4. Partner cabinet для бонусов.
5. QR/coupon redemption.
6. Admin analytics.
7. SLA dashboard.
8. Геокодинг/поиск точки.
9. Offline queue.
10. Multi-language metadata.

## Завтрашний реалистичный план

### Утро

1. Создать App Store Connect app.
2. Войти в Expo/EAS.
3. Поднять backend на Render или другом хостинге.
4. Записать backend URL в EAS env.
5. Записать privacy/support URL.

### День

1. Сделать `npm run doctor`.
2. Сделать `tsc --noEmit`.
3. Сделать production iOS build.
4. Отправить в TestFlight.
5. Пройти iPhone smoke test.

### Вечер

1. Исправить критичные падения.
2. Снять screenshots.
3. Заполнить App Store metadata.
4. Решить: отправляем в App Review или оставляем в TestFlight.

## Рекомендация

Для завтра цель должна быть: **внутренний TestFlight + production-like backend**, а не публичный App Store.

Если пытаться идти сразу в App Review, самые вероятные причины отказа:

- нет полноценной privacy/support инфраструктуры;
- фото/локация/UGC без достаточной модерации и объяснений;
- backend/карта выглядят как прототип;
- админка и пользовательская часть недостаточно разделены;
- приложение может показаться beta/demo, а Apple просит использовать TestFlight для beta.
