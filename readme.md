<div align="center">

# OlConnect Manager

**Панель управления, инсталлятор и серверная часть для протоколов OlConnect и OpenFlux.**

</div>

## Что это

`OlConnect Manager` разворачивает и управляет серверной стороной **OlConnect**: TCP- и IP-туннели маскируются внутри легитимного трафика доверенных сервисов (видеоконференции WebRTC, документы Yandex Docs и Mail.ru Docs), а наружу трафик выходит с вашего VPS.

### Поддерживаемые провайдеры (Carriers):

| Provider | Транспорты | Описание и статус |
|---|---|---|
| `openflux` | `auto`, `vyandex`, `yandex`, `mailru`, `avito`, `cups`, `telemost` | **Рекомендуемый.** L3 IP-туннель через сервисы документов (Yandex Volga/Docs, Mail.ru Docs), платформы лайв-кодинга (Avito Code, VK Cups.online) и Яндекс.Телемост. Не требует регистрации комнат. Поддерживает сквозное шифрование AES-256-GCM и обход SmartCaptcha. |
| `telemost` | `vp8channel`, `videochannel` | WebRTC-сессии через Яндекс.Телемост с автоматической генерацией Room ID. |
| `jitsi` | `vp8channel`, `datachannel`, `seichannel`, `videochannel` | Быстрый старт через публичные серверы Jitsi Meet (meet.jit.si и др.). |
| `wbstream` | `vp8channel`, `datachannel` | WebRTC через WB Stream с поддержкой автоматизации авторизации в браузере. |

---

## Быстрый старт

На чистом Linux VPS (Ubuntu 20.04+, Debian 11+, Alma/Fedora):

```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/olcrtc-setup.sh | sudo bash
```

После установки откройте веб-панель: `https://<IP-вашего-VPS>:8443`.
- При первом входе смените логин и пароль администратора.
- Сертификат панели самоподписанный — подтвердите исключение безопасности в браузере.

### Полное удаление с сервера:

```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/olcrtc-uninstall.sh | sudo bash
```

---

## Основные возможности

- **Современная веб-панель (OlConnect Manager)**:
  - Управление инстансами в реальном времени, запуск/остановка/перезапуск, горячая смена настроек.
  - Поддержка провайдеров `openflux`, `telemost`, `jitsi`, `wbstream`.
  - Мониторинг статуса служб systemd, пинг до внешних узлов, статистика активных пиров и трафика.
  - Встроенный механизм самообновления с проверкой контрольных сумм SHA-256 через GitHub Releases.
- **Поддержка OpenFlux Exit-Node**:
  - Транспорты: Yandex Docs (классический и Volga) и Mail.ru Docs.
  - **Сквозное шифрование AES-256-GCM**: настраивается прямо в панели (поле «Ключ шифрования» с генератором в один клик и возможностью очистки). Ключ автоматически экспортируется в URI (`&k=...`) и в QR-код инстанса.
  - **Автообновление бинарников**: `olcrtc-launcher` и установщик автоматически подтягивают и обновляют бинарники `openflux` из релизов [OpenFlux-Android](https://github.com/Oleglog/OpenFlux-Android) при каждом обновлении панели, перезапуске инстанса или через CLI.
  - Быстрое обновление OpenFlux вручную одной командой:
    ```bash
    curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/update-openflux.sh | sudo bash
    ```
  - Автоматическая изоляция трафика (`iptables`, raw-сокеты, `--local-ip`), буферы 16 MiB.
  - Кодек `legacy` (LZ4) по умолчанию для полной совместимости со всеми версиями мобильного клиента OlConnect.
- **Подписки (`/sub/<slug>`)**:
  - Встроенный сервер подписок для объединения любых инстансов (`olconnect://` и `openflux://`).
  - Генерация прямых ссылок и динамических QR-кодов.
- **Зашифрованные зеркала в Яндекс.Диск**:
  - Публикация зашифрованных AES-256-GCM списков серверов на Яндекс.Диск.
  - Клиенты OlConnect обновляют конфигурацию с зеркала даже при недоступности или блокировке IP-адреса VPS.
- **WARP & SOCKS5 прокси**:
  - Маршрутизация сигнального трафика через SOCKS5 и egress пользовательского трафика через Cloudflare WARP.
- **Автоматизация WB Stream**:
  - Headless-сессия Chromium для получения токенов и создания комнат WB Stream.

---

## Клиентские приложения

- **Android (OlConnect)**: официальный полнофункциональный клиент [OlConnect](https://github.com/Oleglog/OlConnect) ([релизы](https://github.com/Oleglog/OlConnect/releases)). Поддерживает протоколы `olconnect://` и `openflux://` (с авто-детекцией Yandex/Mail.ru Docs и поддержкой AES-256-GCM ключей `&k=`), QR-коды, подписки, обход блокировок с RFC 792 ICMP Port Unreachable fast TCP fallback, темную тему и per-app routing.
- **Android (OpenFlux)**: легковесный специализированный клиент [OpenFlux-Android](https://github.com/Oleglog/OpenFlux-Android) ([релизы](https://github.com/Oleglog/OpenFlux-Android/releases)).
- **Сторонние клиенты (olcbox и подобные) не поддерживаются.** Формат `olcrtc://...?...@...#<ключ>$<MIMO>` из [docs/uri.md](docs/uri.md) панель больше не генерирует: он был удалён в `2.1.5` (issue #45), потому что спецификация осталась без развития. Панель выдаёт `olconnect://` (TCP-туннель) и `openflux://` (L3), их понимают только клиенты выше. Если вставка ссылки в сторонний клиент не проходит — это ожидаемо, а не баг панели.

---

## Сборка из исходников

```bash
go install github.com/magefile/mage@latest
mage test && mage lint && mage build && mage cross
```

Управление сервисом через CLI установщика:
```bash
sudo bash server-install/olcrtc-setup.sh --status
sudo bash server-install/olcrtc-setup.sh --update
```

---

## Лицензия

WTFPL.
