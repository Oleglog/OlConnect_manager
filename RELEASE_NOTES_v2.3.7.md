# OlConnect Manager server-v2.3.7

## Что нового в этом релизе

### 1. Критическое исправление для Mail.ru Docs (401 Unauthorized) и Yandex Volga (client-config not found)
- **Исправление утечки IP через сигнальный прокси (SOCKS5)**:
  - Устранена проблема обхода SOCKS-прокси (`socks5://127.0.0.1:40000`) в запросах авторизации и WebSocket-соединениях Mail.ru (`api/v4/r7/edit`) и Yandex Volga (`dialIPv4First`). Прямые запросы с IP датацентров вызывали немедленные блокировки 401 и вызов капчи. Теперь весь трафик сигнализации строго следует через настроенный прокси.
- **Обход Яндекс SmartCaptcha со статусом 200 OK**:
  - Ранее Яндекс возвращал капчу через 302 редирект на `showcaptchafast`. В новых версиях защита возвращает HTTP 200 OK со встроенным HTML `window.__SSR_DATA__` и формой `checkbox-captcha-form`. Транспорт теперь распознает капчу на странице 200 OK, автоматически решает PoW-задачу и подтверждает токен капчи на правильном хосте (`disk.yandex.ru`), предотвращая краш `client-config not found`.

### 2. Поддержка передачи cookie-файлов Netscape в OpenFlux
- В `olcrtc-launcher` и `olcrtc-setup.sh` добавлена поддержка флага `--cookies`:
  - Автоматически подключает `/etc/olcrtc/cookies.txt`, если файл присутствует на сервере.
  - Поддерживает переменную окружения `OLCRTC_COOKIES` или `OLCRTC_COOKIES_FILE`.
  - Позволяет аутентифицироваться в Mail.ru и Яндекс Документах, когда документы требуют авторизации пользователя.

### 3. Автоматическое обновление OpenFlux до v1.0.5
- Инсталлятор и лаунчер автоматически подтягивают новый релиз OpenFlux `v1.0.5` с исправлениями для Mail.ru Docs, Yandex Volga, Yandex Docs, Avito, Cups.online и Telemost.

---
### Обновление на сервере

```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/olcrtc-setup.sh | sudo bash -s -- --update
```
Или обновление только бинарника OpenFlux:
```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/update-openflux.sh | sudo bash
```
